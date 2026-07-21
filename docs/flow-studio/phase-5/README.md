# Bruno Flow Studio Phase 5

## Advanced control flow và resumable runtime

Phase 5 chuyển Flow Runtime từ một tuyến tuần tự sang deterministic structured scheduler cho DAG có nhánh song song, retry, failure routes, subflow và checkpoint/resume.

Mục tiêu bắt buộc:

- Parallel result không phụ thuộc thứ tự network hoàn thành.
- Join có semantics rõ ràng và kiểm thử được.
- Cancel không trả kết quả khi adapter hoặc child worker còn chạy.
- Resume không tự lặp side effect ngoài policy.
- Renderer không quyết định checkpoint content, canonical revision hoặc child flow definition.

## Runtime architecture

`DeterministicFlowScheduler` là runtime chính trong `@usebruno/flow-core`.
`SequentialFlowScheduler` còn tồn tại như compatibility alias cho caller Phase 4.

Core nhận adapter qua constructor:

- `resolveRequest`
- `executeRequest`
- `resolveSubflow`
- `saveCheckpoint`
- `emitEvent`

Electron main process cung cấp adapter thật. Renderer chỉ gửi run intent và nhận safe projection.

## Condition

Condition dùng evaluator giới hạn, không dùng `eval`, `Function` hoặc JavaScript tùy ý.

Nguồn dữ liệu:

- `inputs.*`
- `dataset.*`
- `error.*`
- `results.<node id hoặc semantic key>.*`
- `nodes.<node id hoặc semantic key>.*`

Toán tử:

- `===`, `!==`, `==`, `!=`
- `>`, `>=`, `<`, `<=`
- `contains`
- `!`, `&&`, `||`

Condition node dùng port `true` và `false`. Khi port tương ứng không tồn tại, runtime chỉ xét route `default` hoặc route không có `sourcePort`, không được rơi nhầm sang port đối nghịch.

## Fork và deterministic parallelism

Fork yêu cầu `config.joinNodeId` trỏ đến Join node.

Branch được sắp deterministic theo:

1. `sourcePort`
2. edge label
3. edge ID

Mỗi branch có index, execution scope, AbortController và output workspace riêng. Network hoàn thành theo thứ tự nào không thay đổi:

- `branchOrder`
- committed `nodeOrder`
- output merge order
- result key order
- checkpoint journal serialization order

Runtime event timestamp vẫn phản ánh thứ tự xảy ra thật và không được dùng làm commit order.

## Join semantics

### `all`

Tất cả branch phải thành công. Một branch fail làm Join fail. Cleanup hoàn tất trước khi Join trả kết quả.

### `all-settled`

Chờ toàn bộ branch settle. Join vẫn thành công nếu có branch fail. Output/result của tất cả branch được giữ và node order vẫn theo branch index.

### `any`

Chọn một successful branch. Winner deterministic là successful branch có index thấp nhất sau khi prefix thấp hơn đã settle, không phải branch về nhanh nhất.

### `quorum`

Cần `config.quorum` successful branches. Runtime chọn success theo branch index và fail khi số success tối đa còn có thể đạt thấp hơn quorum.

### Loser cancellation

`any` và `quorum` chỉ auto-abort pending loser khi static side-effect scan xác định branch abort-safe:

- `none`
- `read-only`
- `idempotent`

Branch chứa `once` phải tự settle. Cancel một POST không chứng minh server chưa thực hiện side effect. Dù loser được abort, Join vẫn await cleanup trước khi trả kết quả.

## Join merge policy

`config.merge`:

- `last-branch-wins`
- `first-branch-wins`
- `error-on-conflict`

Merge áp dụng theo branch index đã compile, không theo completion time.

## Retry và failure route

Retry policy có thể nằm ở `node.policy.retry` hoặc flow defaults:

```yaml
policy:
  sideEffect: idempotent
  resume: reuse
  allowRetry: true
  retry:
    maxAttempts: 3
    backoffMs: 250
    strategy: exponential
```

Strategy: `fixed`, `linear`, `exponential`. Backoff nhận AbortSignal.

Node `once` bị clamp về một attempt trừ khi `allowRetry: true` được cấu hình rõ ràng.

Failure route là control edge có `sourcePort: failure` và chỉ activate sau khi retry đã hết. Compiler báo `FLOW_AMBIGUOUS_FAILURE_ROUTE` nếu route failure không xác định.

## Side-effect policy

| Class | Ý nghĩa |
|---|---|
| `none` | Không có external side effect |
| `read-only` | External operation chỉ đọc |
| `idempotent` | Write có idempotency guarantee |
| `once` | Không được giả định idempotent; mặc định của request và subflow |

| Previous journal state | Resume policy | Kết quả |
|---|---|---|
| success | reuse | Dùng output/result đã checkpoint |
| success | rerun + allowReplay | Execute lại |
| success | rerun không allowReplay | Fail closed |
| success | forbid | Fail closed |
| failed/cancelled once | không allowReplay | Fail closed vì external outcome có thể không chắc chắn |
| failed/cancelled once | allowReplay | Caller chấp nhận rủi ro và execute lại |

`allowReplay` và `allowRetry` phải explicit.

## Execution journal

Mỗi journal entry có deterministic execution key:

```text
flowUid : execution scope : nodeId
```

Entry giữ canonical flow revision, node/scope, status, attempt count, side-effect class, resume policy, raw output cần cho downstream binding, normalized result và safe preview.

Safe run result chỉ chứa journal metadata. Raw journal không gửi sang renderer.

## Checkpoint

Checkpoint node hỗ trợ:

- `pause`: save rồi dừng run
- `snapshot`: save rồi tiếp tục

Checkpoint hiện chỉ hợp lệ ở parent flow và ngoài active fork branch. Runtime từ chối checkpoint trong subflow, trong active fork, hoặc khi main process không cấu hình persistence adapter.

File checkpoint:

```text
<workspace>/.bruno/flow-checkpoints/<flowUid>/<checkpointId>.checkpoint.enc
```

Controls:

- mã hóa trước khi ghi disk
- atomic temporary file + rename
- directory mode `0700`
- file mode `0600`
- raw checkpoint limit 20 MiB
- chặn lexical path escape
- chặn symlink ở checkpoint root, flow directory và checkpoint file
- metadata trong file phải khớp flow/checkpoint path

Renderer chỉ nhận safe metadata: checkpoint ID, flow UID/revision, node ID, timestamp, journal count và valid/invalid status.

## Resume

Resume sequence:

1. Main process canonicalize và validate flow payload.
2. Main process tự tính content-derived revision.
3. Main process đọc và giải mã checkpoint.
4. Scheduler yêu cầu root flow UID và revision khớp tuyệt đối.
5. Journal entry được reuse/rerun/forbid theo side-effect policy.
6. Runtime phát `flow.node.reused` cho node được restore.

Policy, topology, binding, dataset limit hoặc subflow depth thay đổi đều làm revision đổi và checkpoint cũ bị từ chối. Renderer không thể đổi `allowReplay` rồi giữ nguyên revision khai báo.

## Subflow

Subflow được main process resolve từ `FlowPersistenceService` bằng safe relative path hoặc valid FlowStore UID. Renderer không gửi child definition để runtime tin trực tiếp.

Guards:

- recursive flow UID cycle detection
- configurable `defaults.subflowDepth`
- hard depth limit 8
- child dùng cùng scheduler/adapters
- child event được wrap thành `flow.subflow.event`
- checkpoint trong child flow bị cấm

## Bounded dataset

Subflow hỗ trợ `datasetMode: for-each`.

Limits:

- node `maxItems`, hoặc `defaults.datasetLimit`
- hard item limit 100
- node concurrency hoặc flow defaults
- hard concurrency limit 20

Worker pool dùng structured concurrency:

- first child failure abort sibling children qua local AbortController
- không nhận row mới sau failure
- chờ toàn bộ active worker settle
- chỉ sau cleanup mới trả failure về parent

## Cancellation

Parent run có AbortController trong `FlowRuntimeService.activeRuns`. Signal truyền xuyên request adapter, retry backoff, fork branch, subflow child và dataset worker.

Run promise không resolve cancellation cho đến khi toàn bộ branch/child adapter settle. Đây là gate chống orphan network.

## IPC

Renderer to main:

- `renderer:flow-run`
- `renderer:flow-resume`
- `renderer:flow-cancel`
- `renderer:flow-preview-request`
- `renderer:flow-checkpoint-list`
- `renderer:flow-checkpoint-delete`

Main to renderer:

- `main:flow-runtime-event`

## Authoring UI

Assets panel có Condition, Fork, Join, Delay, Subflow, Checkpoint và Failure.

Inspector hỗ trợ condition expression, fork join reference và 2-8 branch handles, join mode/quorum/merge, retry/backoff, failure port, subflow dataset bounds, checkpoint mode và side-effect/resume policy.

Run Console hỗ trợ paused state, safe checkpoint list, resume, delete, retry/reused events và failure-route gradient.

## Runtime event additions

- `flow.branch.started`
- `flow.branch.completed`
- `flow.branch.failed`
- `flow.branch.cancelled`
- `flow.join.satisfied`
- `flow.node.attempt-started`
- `flow.node.attempt-failed`
- `flow.node.retrying`
- `flow.node.reused`
- `flow.failure-route.activated`
- `flow.checkpoint.saved`
- `flow.run.paused`
- `flow.subflow.event`

## Phase 5 gates

- Parallel branches execute concurrently.
- Commit order ổn định dưới inverse response timing.
- Join `all`, `all-settled`, `any`, `quorum` được kiểm thử.
- Any/quorum loser cancellation deterministic và side-effect aware.
- External cancel chờ mọi request adapter settle.
- Dataset child failure abort sibling và chờ cleanup.
- Retry hết mới activate failure route.
- Resume reuse successful once-only work.
- Resume từ chối uncertain failed/cancelled once-only work nếu không explicit replay.
- Main-computed revision chặn policy tampering.
- Recursive subflow bị từ chối.
- Dataset và subflow depth có bounds.
- Checkpoint journal được mã hóa và không lọt safe projection.

## Verification

- `@usebruno/flow-core`: 4 suites, 38 tests passing.
- Flow Studio editor/runtime UI: 12 suites, 45 tests passing.
- Electron Flow Studio services và IPC: 8 suites, 38 tests passing.
- Bruno App production build: passing.
- Targeted ESLint errors-only cho Phase 5: passing.
- `git diff --check`: passing.
- Direct scan không tìm thấy `eval`, `Function` constructor hoặc raw checkpoint secret trong source boundary Phase 5.

Hardening bổ sung trong gate review:

- Runtime từ chối compiler diagnostics mức error trước khi gọi request adapter.
- Quorum ngoài phạm vi branch bị compiler, editor validator và scheduler từ chối thay vì clamp âm thầm.
- Nhiều failure route cùng match bị fail closed thay vì chọn edge đầu tiên.
- Static loser-cancellation scan bao gồm cả failure path, tránh abort branch có once-only recovery side effect.
- Renderer-facing request results luôn qua safe projection.
- Checkpoint root và flow directory được ép quyền `0700`; checkpoint file giữ `0600`.

## Deliberate boundaries

- General loops chưa bật; compiler vẫn từ chối control cycle khi chưa có bounded-loop policy.
- Scheduler là process-local, không phải distributed workflow engine.
- Event arrival order phản ánh thực tế; committed graph state mới deterministic.
- Checkpoint trong fork branch hoặc child subflow bị cấm ở Phase 5.
- `any` và `quorum` không forcibly abort once-only loser.
- Dynamic runtime variables vẫn là mounted session state theo boundary Phase 4.
