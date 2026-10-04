export const PERMISSIONS: [string, string][] = [
  ['dashboard.view', 'Dashboard dekhna'],
  ['products.view', 'Products dekhna'], ['products.edit', 'Products add/edit/delete'],
  ['inventory.view', 'Stock dekhna'], ['inventory.adjust', 'Stock adjustment'],
  ['sales.pos', 'POS / billing'], ['sales.view', 'Sales dekhna'], ['sales.cancel', 'Sale cancel karna'],
  ['purchases.view', 'Purchases dekhna'], ['purchases.edit', 'Purchase add/edit'],
  ['customers.view', 'Customers dekhna'], ['customers.edit', 'Customers add/edit'],
  ['suppliers.view', 'Suppliers dekhna'], ['suppliers.edit', 'Suppliers add/edit'],
  ['returns.manage', 'Returns'], ['expenses.manage', 'Expenses'],
  ['reports.view', 'Reports'], ['daily_closing.manage', 'Daily closing'],
  ['import.run', 'Import'], ['export.run', 'Export'],
  ['backup.manage', 'Backup / Restore'],
  ['users.manage', 'Users aur roles'], ['audit.view', 'Audit log'], ['settings.edit', 'Settings'],
];

const ALL = PERMISSIONS.map(p => p[0]);
export const ROLE_DEFAULTS: Record<string, string[]> = {
  Owner: ALL,
  Manager: ALL.filter(k => !['users.manage', 'settings.edit', 'backup.manage'].includes(k)),
  'Billing Staff': ['dashboard.view', 'sales.pos', 'sales.view', 'customers.view', 'customers.edit', 'products.view'],
  'Inventory Staff': ['dashboard.view', 'products.view', 'products.edit', 'inventory.view', 'inventory.adjust', 'purchases.view', 'purchases.edit', 'suppliers.view'],
};
