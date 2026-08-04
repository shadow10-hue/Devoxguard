import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import FindingDetailView from '../FindingDetailView.vue';
import { devoxguardClient } from '../../api/devoxguard-client';

vi.mock('../../api/devoxguard-client', () => ({
  devoxguardClient: { getFinding: vi.fn() },
}));

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/findings', name: 'findings', component: { template: '<div />' } },
      { path: '/findings/:id', name: 'finding-detail', component: FindingDetailView },
    ],
  });
}

describe('FindingDetailView', () => {
  it('loads the finding for the route id and renders its RequestContext', async () => {
    vi.mocked(devoxguardClient.getFinding).mockResolvedValue({
      id: 'f-1',
      requestId: 'req-1',
      type: 'idor',
      severity: 'high',
      route: '/orders/:id',
      method: 'GET',
      userId: 'user-1',
      detail: 'Requested order id not owned by caller',
      actionTaken: 'blocked',
      timestamp: 1_700_000_000_000,
      requestContext: {
        requestId: 'req-1',
        timestamp: 1_700_000_000_000,
        route: '/orders/:id',
        method: 'GET',
        params: { id: '99' },
        query: {},
        body: null,
        headers: {},
        authenticatedUser: { id: 'user-1' },
        originIp: '10.0.0.1',
      },
    });

    const router = makeRouter();
    router.push('/findings/f-1');
    await router.isReady();

    const wrapper = mount(FindingDetailView, { global: { plugins: [router] } });
    await flushPromises();

    expect(devoxguardClient.getFinding).toHaveBeenCalledWith('f-1');
    expect(wrapper.text()).toContain('Requested order id not owned by caller');
    // Request context is now rendered as a structured key/value tree
    // (KeyValueTree.vue) instead of a raw JSON.stringify dump, so this
    // asserts the humanized label + value rather than JSON punctuation.
    expect(wrapper.text()).toContain('Origin Ip');
    expect(wrapper.text()).toContain('10.0.0.1');
  });

  it('shows an error message when the request fails', async () => {
    vi.mocked(devoxguardClient.getFinding).mockRejectedValue(new Error('not found'));

    const router = makeRouter();
    router.push('/findings/missing');
    await router.isReady();

    const wrapper = mount(FindingDetailView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain('Failed to load finding');
  });
});
