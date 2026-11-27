import type { MenuNode } from '@/stores/session';

/** Flattens the menu tree into leaf entries with their trail (for breadcrumbs & search) */
export function flattenMenus(nodes: MenuNode[], trail: MenuNode[] = []): { node: MenuNode; trail: MenuNode[] }[] {
  return nodes.flatMap((n) => (n.children.length ? flattenMenus(n.children, [...trail, n]) : n.path ? [{ node: n, trail }] : []));
}
