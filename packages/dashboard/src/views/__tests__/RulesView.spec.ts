import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import RulesView from '../RulesView.vue';
import { devoxguardClient } from '../../api/devoxguard-client';

vi.mock('../../api/devoxguard-client', () => ({
  devoxguardClient: { getRules: vi.fn() },
}));

describe('RulesView', () => {
  it('renders the loaded rules with their raw condition text', async () => {
    vi.mocked(devoxguardClient.getRules).mockResolvedValue([
      {
        nom: 'idor-orders',
        route: '/orders/:id',
        methode: 'GET',
        action: 'bloquer',
        severite: 'high',
        raw: 'params.id not in user.ownedResourceIds.orders',
      },
    ]);

    const wrapper = mount(RulesView);
    await flushPromises();

    expect(wrapper.text()).toContain('idor-orders');
    expect(wrapper.text()).toContain('params.id not in user.ownedResourceIds.orders');
  });

  it('shows an error message when the request fails', async () => {
    vi.mocked(devoxguardClient.getRules).mockRejectedValue(new Error('network error'));

    const wrapper = mount(RulesView);
    await flushPromises();

    expect(wrapper.text()).toContain('Failed to load rules');
  });
});
