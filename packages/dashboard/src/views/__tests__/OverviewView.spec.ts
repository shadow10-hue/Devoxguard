import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import OverviewView from '../OverviewView.vue';
import { devoxguardClient } from '../../api/devoxguard-client';

vi.mock('../../api/devoxguard-client', () => ({
  devoxguardClient: { getOverview: vi.fn() },
}));

describe('OverviewView', () => {
  it('renders the overview stats once loaded', async () => {
    vi.mocked(devoxguardClient.getOverview).mockResolvedValue({
      blockedLast24h: 7,
      topRulesTriggered: [{ ruleName: 'idor-orders', count: 4 }],
      averageAnomalyScoreTrend: [{ timestamp: 1_700_000_000_000, score: 0.42 }],
    });

    const wrapper = mount(OverviewView);
    await flushPromises();

    expect(wrapper.text()).toContain('7');
    expect(wrapper.text()).toContain('idor-orders');
    expect(wrapper.text()).toContain('0.42');
  });

  it('shows an error message when the request fails', async () => {
    vi.mocked(devoxguardClient.getOverview).mockRejectedValue(new Error('network error'));

    const wrapper = mount(OverviewView);
    await flushPromises();

    expect(wrapper.text()).toContain('Failed to load overview stats');
  });
});
