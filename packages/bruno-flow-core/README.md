# @usebruno/flow-core

Domain and persistence primitives for Bruno Flow Studio.

The root export is filesystem-free and contains schema validation, parsing, deterministic YAML serialization, migrations, revision hashing, and the compiler skeleton.

Node persistence lives under:

```js
const { FlowStore, FlowWatcher } = require('@usebruno/flow-core/persistence');
```

Flow files are stored under `workspace/flows/**/*.flow.yml`. Draft recovery data is stored outside that tree under `workspace/.bruno/flow-drafts` so watchers and Git-facing flow files remain clean.
