export interface Customer { id: string; name: string; email: string; company: string | null; phone: string | null; address: string | null; createdAt: string; _count: { subscriptions: number } }
export interface Product { id: string; name: string; salesPriceMinor: number; isActive: boolean; variants?: { id: string; name: string; priceAdjustmentMinor: number; isActive: boolean }[] }
export interface Plan { id: string; name: string; productId: string; priceMinor: number; minimumQuantity: number; interval: string; isActive: boolean }
export interface Tax { id: string; name: string; rateBps: number; isActive: boolean }
export interface LineInput { productId: string; variantId: string | null; quantity: number; unitPriceMinor: number; taxRuleId: string | null }
export interface Subscription { id: string; number: string; customer: Pick<Customer, 'id' | 'name'>; plan: Pick<Plan, 'id' | 'name'>; status: string; startDate: string; expiryDate: string | null; createdAt: string }
export interface Detail extends Omit<Subscription, 'customer'> { customer: Customer; billingInterval: string; paymentTermDays: number; quotationValidUntil: string | null; lines: (LineInput & { id: string; description: string; taxRateBps: number; subtotalMinor: number; taxMinor: number; totalMinor: number })[]; subtotalMinor: number; taxMinor: number; totalMinor: number }
export const businessDate = (value: string | null) => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(new Date(value)) : '—';
export interface TemplateSummary { id: string; name: string; planId: string; plan: { id: string; name: string }; validDays: number; paymentTermDays: number; createdAt: string; _count: { lines: number } }
export interface Template extends Omit<TemplateSummary, '_count'> { lines: Detail['lines']; subtotalMinor: number; taxMinor: number; totalMinor: number }
