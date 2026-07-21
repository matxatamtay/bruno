import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AssetsPanel from './AssetsPanel';
import { FLOW_ASSET_MIME, FLOW_ASSET_TEXT_PREFIX } from '../model';

const assets = [
  {
    assetType: 'request',
    id: 'accounts:create-user',
    collectionUid: 'accounts',
    collectionName: 'Accounts',
    collectionPath: '.',
    itemUid: 'create-user',
    itemPathname: 'users/create.bru',
    name: 'Create user',
    type: 'http-request',
    method: 'POST',
    url: 'https://example.test/users'
  },
  {
    assetType: 'request',
    id: 'accounts:update-user',
    collectionUid: 'accounts',
    collectionName: 'Accounts',
    collectionPath: '.',
    itemUid: 'update-user',
    itemPathname: 'users/update.bru',
    name: 'Update user',
    type: 'http-request',
    method: 'PATCH',
    breadcrumb: 'Users'
  }
];

describe('Flow Studio collection assets panel', () => {
  it('publishes canonical request drag payloads from the current collection', () => {
    render(
      <AssetsPanel
        requestAssets={assets}
        collectionName="Accounts"
        searchQuery=""
        onSearchQueryChange={() => {}}
        searchInputRef={null}
      />
    );
    const setData = jest.fn();
    const dataTransfer = { setData, effectAllowed: '' };

    fireEvent.dragStart(screen.getByTitle('Accounts / Create user'), { dataTransfer });
    fireEvent.dragStart(screen.getByTitle('Accounts / Users / Update user'), { dataTransfer });

    expect(setData).toHaveBeenNthCalledWith(1, FLOW_ASSET_MIME, JSON.stringify(assets[0]));
    expect(setData).toHaveBeenNthCalledWith(2, 'text/plain', `${FLOW_ASSET_TEXT_PREFIX}${JSON.stringify(assets[0])}`);
    expect(setData).toHaveBeenNthCalledWith(3, FLOW_ASSET_MIME, JSON.stringify(assets[1]));
    expect(setData).toHaveBeenNthCalledWith(4, 'text/plain', `${FLOW_ASSET_TEXT_PREFIX}${JSON.stringify(assets[1])}`);
    expect(screen.getByText('Collection · Accounts')).toBeInTheDocument();
    expect(screen.getByTitle('Users')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('flow-assets-scroll')).toBeInTheDocument();
  });

  it('filters collection requests while keeping response mapping and control assets available', () => {
    const { rerender } = render(
      <AssetsPanel
        requestAssets={assets}
        collectionName="Accounts"
        searchQuery="update"
        onSearchQueryChange={() => {}}
        searchInputRef={null}
      />
    );

    expect(screen.queryByText('Create user')).not.toBeInTheDocument();
    expect(screen.getByText('Update user')).toBeInTheDocument();
    expect(screen.getByText('Response value')).toBeInTheDocument();
    expect(screen.getByText('Merge values')).toBeInTheDocument();
    expect(screen.queryByText('Environment variable')).not.toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('Fork branches')).toBeInTheDocument();

    rerender(
      <AssetsPanel
        requestAssets={assets}
        collectionName="Accounts"
        searchQuery="create"
        onSearchQueryChange={() => {}}
        searchInputRef={null}
      />
    );
    expect(screen.getByText('Create user')).toBeInTheDocument();
    expect(screen.queryByText('Update user')).not.toBeInTheDocument();
  });
});
