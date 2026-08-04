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
  {
    id: '1',
    name: 'Alice',
    role: 'user',
    isAdmin: false,
    passwordHash: 'hash-alice-9f8a',
  },
  {
    id: '2',
    name: 'Bob',
    role: 'user',
    isAdmin: false,
    passwordHash: 'hash-bob-3c21',
  },
];

export const ORDERS: SeedOrder[] = [
  { id: '1', userId: '1', item: 'Widget', total: 20 },
  { id: '2', userId: '1', item: 'Gadget', total: 40 },
  { id: '3', userId: '2', item: 'Gizmo', total: 15 },
  // Ids 10-14: a consecutive block owned entirely by user 1, added for
  // scripts/load-test.ts. The sequence-scan anomaly detector needs 5+
  // consecutive owned ids to exercise it without also tripping the
  // idor-orders block rule (which takes priority over rate-limiting).
  { id: '10', userId: '1', item: 'Doohickey', total: 12 },
  { id: '11', userId: '1', item: 'Thingamajig', total: 8 },
  { id: '12', userId: '1', item: 'Whatsit', total: 22 },
  { id: '13', userId: '1', item: 'Gadgetoid', total: 5 },
  { id: '14', userId: '1', item: 'Contraption', total: 33 },
];

export const REVIEWS: SeedReview[] = [
  { id: '1', orderId: '1', userId: '1', rating: 5, comment: 'Great!' },
];

export function ownedOrderIds(userId: string): string[] {
  return ORDERS.filter((order) => order.userId === userId).map(
    (order) => order.id,
  );
}
