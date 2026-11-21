import { lazy } from 'react';
import type { ResourceUi } from './types';
import { EmployeeDirectoryView } from '@/features/insights/hr/EmployeeDirectoryView';
import { DepartmentTreeView } from '@/features/insights/hr/DepartmentTreeView';
import { LeaveCalendarView } from '@/features/insights/hr/LeaveCalendarView';

const AttendanceMonthPage = lazy(() => import('@/features/hris/attendance/AttendanceMonthPage'));

export const hrUi: Record<string, ResourceUi> = {
  attendances: { page: AttendanceMonthPage },
  employees: {
    views: [{ id: 'directory', label: 'Directory', icon: 'contact', component: EmployeeDirectoryView }],
    detailPath: (r) => `/employees/${r.id}`,
  },
  departments: { views: [{ id: 'org', label: 'Org structure', icon: 'network', component: DepartmentTreeView, pageSize: 1, selfLoading: true }] },
  'leave-requests': { views: [{ id: 'calendar', label: 'Calendar', icon: 'calendar-days', component: LeaveCalendarView, pageSize: 1, selfLoading: true }] },
};
