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
    collectionPath: 'collections/accounts',
    itemUid: 'create-user',
    itemPathname: 'users/create.bru',
    name: 'Create user',
    type: 'http-request',
    method: 'POST',
    url: 'https://example.test/users'
  },
  {
    assetType: 'request',
    id: 'billing:charge',
    collectionUid: 'billing',
    collectionName: 'Billing',
    collectionPath: 'collections/billing',
    itemUid: 'charge',
    itemPathname: 'checkout/charge.bru',
    name: 'Charge card',
    type: 'graphql-request',
    method: 'POST',
    breadcrumb: 'Checkout'
  }
];

describe('Flow Studio assets panel', () => {
  it('publishes drag payloads for requests from different collections', () => {
    render(
      <AssetsPanel
        requestAssets={assets}
        searchQuery=""
        onSearchQueryChange={() => {}}
        searchInputRef={null}
      />
    );
    const setData = jest.fn();
    const dataTransfer = { setData, effectAllowed: '' };

    fireEvent.dragStart(screen.getByTitle('Accounts / Create user'), { dataTransfer });
    fireEvent.dragStart(screen.getByTitle('Billing / Checkout / Charge card'), { dataTransfer });

    expect(setData).toHaveBeenNthCalledWith(1, FLOW_ASSET_MIME, JSON.stringify(assets[0]));
    expect(setData).toHaveBeenNthCalledWith(2, 'text/plain', `${FLOW_ASSET_TEXT_PREFIX}${JSON.stringify(assets[0])}`);
    expect(setData).toHaveBeenNthCalledWith(3, FLOW_ASSET_MIME, JSON.stringify(assets[1]));
    expect(setData).toHaveBeenNthCalledWith(4, 'text/plain', `${FLOW_ASSET_TEXT_PREFIX}${JSON.stringify(assets[1])}`);
  });

  it('filters collection requests while keeping input node assets available', () => {
    const { rerender } = render(
      <AssetsPanel
        requestAssets={assets}
        searchQuery="charge"
        onSearchQueryChange={() => {}}
        searchInputRef={null}
      />
    );

    expect(screen.queryByText('Create user')).not.toBeInTheDocument();
    expect(screen.getByText('Charge card')).toBeInTheDocument();
    expect(screen.getByText('Static value')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('Fork branches')).toBeInTheDocument();

    rerender(
      <AssetsPanel
        requestAssets={assets}
        searchQuery="accounts"
        onSearchQueryChange={() => {}}
        searchInputRef={null}
      />
    );
    expect(screen.getByText('Create user')).toBeInTheDocument();
    expect(screen.queryByText('Charge card')).not.toBeInTheDocument();
  });
});
