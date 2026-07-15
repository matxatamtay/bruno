import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('react-hot-toast', () => ({ error: jest.fn() }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('utils/common/error', () => ({ formatIpcError: (error) => error?.message || '' }));
jest.mock('./StyledWrapper', () => ({ children }) => <div>{children}</div>);
jest.mock('./GitRequestTree', () => ({ files }) => <div data-testid="request-tree">{files.length} files</div>);
jest.mock('./GitRequestDiff', () => ({ loading }) => <div data-testid="request-diff">{loading ? 'diff loading' : 'diff ready'}</div>);
jest.mock('./SemanticReviewPanel', () => () => <div data-testid="semantic-review" />);
jest.mock('./RunAffectedModal', () => () => <div data-testid="run-affected-modal" />);

import GitReview from './index';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('GitReview loading states', () => {
  afterEach(() => {
    delete window.ipcRenderer;
  });

  it('shows changed files before the first file diff finishes loading', async () => {
    const fileReview = deferred();
    window.ipcRenderer = {
      invoke: jest.fn((channel) => {
        if (channel === 'renderer:get-current-branch-commits') {
          return Promise.resolve({
            branch: 'main',
            commits: [{ hash: 'abcdef123456', message: 'change requests', author_name: 'Vinh', date: '2026-07-14T12:00:00.000Z' }],
            hasMore: false
          });
        }
        if (channel === 'renderer:get-commit-review') {
          return Promise.resolve({
            files: [{ path: 'requests/ping.bru', oldPath: 'requests/ping.bru', collectionRelativePath: 'ping.bru', status: 'modified', supportsVisualDiff: true }]
          });
        }
        if (channel === 'renderer:get-commit-file-review') {
          return fileReview.promise;
        }
        if (channel === 'renderer:get-commit-semantic-review') {
          return Promise.resolve({ summary: {}, findings: [], affectedRequests: [] });
        }
        return Promise.reject(new Error(`Unexpected IPC channel: ${channel}`));
      })
    };

    render(<GitReview collection={{ name: 'API', pathname: '/tmp/api', items: [] }} />);

    await waitFor(() => expect(screen.getByTestId('request-tree')).toHaveTextContent('1 files'));
    expect(screen.queryByText('Reading commit')).not.toBeInTheDocument();
    expect(screen.getByTestId('request-diff')).toHaveTextContent('diff loading');

    fileReview.resolve({ oldContent: '', newContent: '', oldParsed: null, newParsed: null });
    await waitFor(() => expect(screen.getByTestId('request-diff')).toHaveTextContent('diff ready'));
  });
});
