import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ErrorBoundary, { isIgnorableGlobalError } from './index';

jest.mock('components/Bruno/index', () => () => <div data-testid="bruno-logo" />);

const dispatchWindowError = ({ message, error }) => {
  const event = new Event('error', { cancelable: true });
  Object.defineProperties(event, {
    message: { value: message },
    error: { value: error }
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

describe('global ErrorBoundary', () => {
  it.each([
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.'
  ])('ignores benign ResizeObserver errors: %s', (message) => {
    render(
      <ErrorBoundary>
        <div>Flow Studio remains mounted</div>
      </ErrorBoundary>
    );

    const event = dispatchWindowError({ message, error: new Error(message) });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText('Flow Studio remains mounted')).toBeInTheDocument();
    expect(screen.queryByText('Oops! Something went wrong')).not.toBeInTheDocument();
  });

  it('still renders the fallback for a genuine global error', () => {
    render(
      <ErrorBoundary>
        <div>Application content</div>
      </ErrorBoundary>
    );

    dispatchWindowError({ message: 'renderer exploded', error: new Error('renderer exploded') });

    expect(screen.getByText('Oops! Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('renderer exploded')).toBeInTheDocument();
  });

  it('classifies only known ResizeObserver loop messages as ignorable', () => {
    expect(isIgnorableGlobalError('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isIgnorableGlobalError('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isIgnorableGlobalError('TypeError: cannot read properties of undefined')).toBe(false);
  });
});
