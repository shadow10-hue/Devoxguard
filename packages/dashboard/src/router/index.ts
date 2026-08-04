import { createRouter, createWebHistory } from 'vue-router';
import OverviewView from '../views/OverviewView.vue';
import FindingsListView from '../views/FindingsListView.vue';
import FindingDetailView from '../views/FindingDetailView.vue';
import RulesView from '../views/RulesView.vue';

export type NavKey = 'overview' | 'findings' | 'rules';

declare module 'vue-router' {
  interface RouteMeta {
    // Optional: test files build their own minimal routers without this field.
    navKey?: NavKey;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: OverviewView, meta: { navKey: 'overview' } },
    { path: '/findings', name: 'findings', component: FindingsListView, meta: { navKey: 'findings' } },
    {
      path: '/findings/:id',
      name: 'finding-detail',
      component: FindingDetailView,
      props: true,
      meta: { navKey: 'findings' },
    },
    { path: '/rules', name: 'rules', component: RulesView, meta: { navKey: 'rules' } },
  ],
});

export default router;
