import { createRouter, createWebHistory } from 'vue-router';
import OverviewView from '../views/OverviewView.vue';
import FindingsListView from '../views/FindingsListView.vue';
import FindingDetailView from '../views/FindingDetailView.vue';
import RulesView from '../views/RulesView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: OverviewView },
    { path: '/findings', name: 'findings', component: FindingsListView },
    { path: '/findings/:id', name: 'finding-detail', component: FindingDetailView, props: true },
    { path: '/rules', name: 'rules', component: RulesView },
  ],
});

export default router;
