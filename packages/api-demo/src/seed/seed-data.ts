export interface SeedUser {
  id: string;
  name: string;
  role: 'user' | 'admin';
  isAdmin: boolean;
  passwordHash: string;
}

export interface SeedOrder {
  id: string;
  userId: string;
  item: string;
  total: number;
}

export interface SeedReview {
  id: string;
  orderId: string;
  userId: string;
  rating: number;
  comment: string;
}

export const USERS: SeedUser[] = [
  { id: '1', name: 'Alice', role: 'user', isAdmin: false, passwordHash: 'hash-alice-9f8a' },
  { id: '2', name: 'Bob', role: 'user', isAdmin: false, passwordHash: 'hash-bob-3c21' },
];

export const ORDERS: SeedOrder[] = [
  { id: '1', userId: '1', item: 'Widget', total: 20 },
  { id: '2', userId: '1', item: 'Gadget', total: 40 },
  { id: '3', userId: '2', item: 'Gizmo', total: 15 },
];

export const REVIEWS: SeedReview[] = [
  { id: '1', orderId: '1', userId: '1', rating: 5, comment: 'Great!' },
];

export function ownedOrderIds(userId: string): string[] {
  return ORDERS.filter((order) => order.userId === userId).map((order) => order.id);
}
