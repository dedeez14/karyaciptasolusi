import type { ResourceUi } from './types';
import {
  ActivityAgendaView,
  CampaignCardsView,
  LeadKanbanView,
  OpportunityHeader,
  PartnerCardsView,
  ProductCatalogView,
  ProjectCardsView,
  WarehouseCardsView,
} from '@/features/insights/commercial/views';

/** CRM, sales, purchasing, inventory and projects */
export const commercialUi: Record<string, ResourceUi> = {
  customers: { views: [{ id: 'cards', label: 'Cards', icon: 'layout-grid', component: PartnerCardsView }], tableFirst: true, detailPath: (r) => `/customers/${r.id}` },
  suppliers: { views: [{ id: 'cards', label: 'Cards', icon: 'layout-grid', component: PartnerCardsView }], tableFirst: true, detailPath: (r) => `/suppliers/${r.id}` },
  products: { views: [{ id: 'catalog', label: 'Catalog', icon: 'layout-grid', component: ProductCatalogView, pageSize: 120 }], detailPath: (r) => `/products/${r.id}` },
  warehouses: { views: [{ id: 'cards', label: 'Cards', icon: 'warehouse', component: WarehouseCardsView }] },
  leads: { views: [{ id: 'board', label: 'Board', icon: 'square-kanban', component: LeadKanbanView }] },
  'crm-activities': { views: [{ id: 'agenda', label: 'Agenda', icon: 'calendar-check', component: ActivityAgendaView }] },
  campaigns: { views: [{ id: 'cards', label: 'Cards', icon: 'layout-grid', component: CampaignCardsView }] },
  opportunities: { header: OpportunityHeader },
  projects: { views: [{ id: 'cards', label: 'Cards', icon: 'layout-grid', component: ProjectCardsView }], detailPath: (r) => `/projects/${r.id}` },
};
