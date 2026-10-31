import { db } from '../server/src/lib/db.js';

async function seed() {
  console.log('Seeding coordinated demo catalog fixtures...');

  // 1. Products & Variants
  let workspace = await db.product.findFirst({ where: { name: 'BrightCloud Workspace' } });
  if (!workspace) {
    workspace = await db.product.create({
      data: {
        name: 'BrightCloud Workspace',
        type: 'SOFTWARE',
        salesPriceMinor: 499900, // ₹4,999.00
        costPriceMinor: 150000,  // ₹1,500.00
        notes: 'Core collaborative SaaS workspace with multi-user access.',
        isActive: true,
        variants: {
          create: [
            { name: 'Standard (5 Seats)', priceAdjustmentMinor: 0, isActive: true },
            { name: 'Professional (20 Seats)', priceAdjustmentMinor: 300000, isActive: true },
            { name: 'Enterprise (Unlimited)', priceAdjustmentMinor: 1000000, isActive: true },
          ],
        },
      },
    });
    console.log('  ✓ Created product: BrightCloud Workspace with 3 variants');
  }

  let support = await db.product.findFirst({ where: { name: 'Premium SLA & Dedicated Support' } });
  if (!support) {
    support = await db.product.create({
      data: {
        name: 'Premium SLA & Dedicated Support',
        type: 'SERVICE',
        salesPriceMinor: 199900, // ₹1,999.00
        costPriceMinor: 50000,   // ₹500.00
        notes: '24/7 dedicated support engineering with 1-hour critical response SLA.',
        isActive: true,
      },
    });
    console.log('  ✓ Created product: Premium SLA & Dedicated Support');
  }

  let hardwareKey = await db.product.findFirst({ where: { name: 'Hardware Security FIDO2 Key' } });
  if (!hardwareKey) {
    hardwareKey = await db.product.create({
      data: {
        name: 'Hardware Security FIDO2 Key',
        type: 'HARDWARE',
        salesPriceMinor: 249900, // ₹2,499.00
        costPriceMinor: 100000,  // ₹1,000.00
        notes: 'Hardware cryptographic security key for biometric authentication.',
        isActive: true,
      },
    });
    console.log('  ✓ Created product: Hardware Security FIDO2 Key');
  }

  // 2. Recurring Plans with Lifecycle Controls
  let monthlyPlan = await db.plan.findFirst({ where: { name: 'Workspace Monthly Growth' } });
  if (!monthlyPlan && workspace) {
    monthlyPlan = await db.plan.create({
      data: {
        name: 'Workspace Monthly Growth',
        productId: workspace.id,
        priceMinor: 499900,
        interval: 'MONTHLY',
        minimumQuantity: 1,
        availableFrom: new Date('2026-01-01T00:00:00.000Z'),
        autoClose: true,
        allowEarlyClose: true,
        allowPause: true,
        allowRenew: true,
        isActive: true,
      },
    });
    console.log('  ✓ Created plan: Workspace Monthly Growth (Lifecycle: AutoClose, EarlyClose, Pause, Renew)');
  }

  let annualPlan = await db.plan.findFirst({ where: { name: 'Workspace Annual Enterprise' } });
  if (!annualPlan && workspace) {
    annualPlan = await db.plan.create({
      data: {
        name: 'Workspace Annual Enterprise',
        productId: workspace.id,
        priceMinor: 4999000, // ₹49,990.00 (2 months free discount)
        interval: 'YEARLY',
        minimumQuantity: 1,
        availableFrom: new Date('2026-01-01T00:00:00.000Z'),
        autoClose: true,
        allowEarlyClose: true,
        allowPause: false,
        allowRenew: true,
        isActive: true,
      },
    });
    console.log('  ✓ Created plan: Workspace Annual Enterprise');
  }

  // 3. Tax Rules (Integer Basis Points)
  const taxesToSeed = [
    { name: 'GST 18% (Standard Software/Services)', rateBps: 1800 },
    { name: 'Reduced VAT 5% (Hardware Accessories)', rateBps: 500 },
    { name: 'Exempt 0% (Tax Exempt)', rateBps: 0 },
  ];

  for (const tax of taxesToSeed) {
    const existing = await db.taxRule.findFirst({ where: { name: tax.name } });
    if (!existing) {
      await db.taxRule.create({ data: { name: tax.name, rateBps: tax.rateBps, isActive: true } });
      console.log(`  ✓ Created tax rule: ${tax.name} (${tax.rateBps} bps)`);
    }
  }

  // 4. Discount Rules (Deterministic Single-Discount Policy)
  const existingSubDiscount = await db.discountRule.findFirst({ where: { name: 'Early Adopter 10% Subscription Discount' } });
  if (!existingSubDiscount) {
    await db.discountRule.create({
      data: {
        name: 'Early Adopter 10% Subscription Discount',
        kind: 'PERCENTAGE',
        scope: 'SUBSCRIPTION',
        value: 1000, // 1000 basis points = 10%
        minimumPurchaseMinor: 400000, // ₹4,000.00
        minimumQuantity: 1,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        usageLimit: 100,
        isActive: true,
      },
    });
    console.log('  ✓ Created discount rule: Early Adopter 10% Subscription Discount (1000 bps)');
  }

  if (hardwareKey) {
    const existingProductDiscount = await db.discountRule.findFirst({ where: { name: 'Hardware Launch ₹500 Discount' } });
    if (!existingProductDiscount) {
      await db.discountRule.create({
        data: {
          name: 'Hardware Launch ₹500 Discount',
          kind: 'FIXED',
          scope: 'PRODUCT',
          productId: hardwareKey.id,
          value: 50000, // ₹500.00
          minimumPurchaseMinor: 0,
          minimumQuantity: 1,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          usageLimit: 50,
          isActive: true,
        },
      });
      console.log('  ✓ Created discount rule: Hardware Launch ₹500 Discount (Fixed Product Scope)');
    }
  }

  console.log('Catalog fixtures seeding complete.');
}

seed()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
