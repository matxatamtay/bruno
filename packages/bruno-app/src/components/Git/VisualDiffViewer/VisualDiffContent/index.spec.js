import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('./StyledWrapper', () => ({ children }) => <div>{children}</div>);
jest.mock('../CollapsibleDiffRow', () => ({ title, oldContent, newContent }) => (
  <section>
    <h2>{title}</h2>
    <div>{oldContent}</div>
    <div>{newContent}</div>
  </section>
));

import VisualDiffContent from './index';

const Side = ({ showSide }) => <span>{showSide}</span>;

const UnstablePropsHarness = ({ renderNumber }) => {
  const sections = [{
    key: 'request',
    title: `Request ${renderNumber}`,
    Component: Side,
    hasContent: () => true
  }];

  return (
    <VisualDiffContent
      oldData={{ value: 'before' }}
      newData={{ value: 'after' }}
      sections={sections}
      sectionHasChanges={() => true}
    />
  );
};

describe('VisualDiffContent', () => {
  it('does not enter a render loop when section props are recreated', () => {
    const { rerender } = render(<UnstablePropsHarness renderNumber={1} />);
    expect(screen.getByText('Request 1')).toBeInTheDocument();

    rerender(<UnstablePropsHarness renderNumber={2} />);
    expect(screen.getByText('Request 2')).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
  });
});
