import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import FindingsListView from '../FindingsListView.vue';
import { devoxguardClient } from '../../api/devoxguard-client';

vi.mock('../../api/devoxguard-client', () => ({
  devoxguardClient: { getFindings: vi.fn() },
}));

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'findings', component: FindingsListView },
      { path: '/findings/:id', name: 'finding-detail', component: { template: '<div />' } },
    ],
  });
}

describe('FindingsListView', () => {
  it('renders the returned findings and pagination total', async () => {
    vi.mocked(devoxguardClient.getFindings).mockResolvedValue({
      items: [
        {
          id: 'f-1',
          requestId: 'req-1',
          type: 'idor',
          severity: 'high',
          route: '/orders/:id',
          method: 'GET',
          userId: 'user-1',
          detail: 'test',
          actionTaken: 'blocked',
          timestamp: 1_700_000_000_000,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const router = makeRouter();
    router.push('/');
    await router.isReady();

    const wrapper = mount(FindingsListView, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.text()).toContain('idor');
    expect(wrapper.text()).toContain('1 total');
  });

  it('navigates to the finding detail route when a row is clicked', async () => {
    vi.mocked(devoxguardClient.getFindings).mockResolvedValue({
      items: [
        {
          id: 'f-42',
          requestId: 'req-1',
          type: 'mass-assignment',
          severity: 'high',
          route: '/users/:id',
          method: 'PATCH',
          userId: 'user-1',
          detail: 'test',
          actionTaken: 'blocked',
          timestamp: 1_700_000_000_000,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const router = makeRouter();
    router.push('/');
    await router.isReady();

    const wrapper = mount(FindingsListView, { global: { plugins: [router] } });
    await flushPromises();

    await wrapper.find('tr.row').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/findings/f-42');
  });
});
