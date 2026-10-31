import { useState, useEffect, useCallback } from 'react';
import { api, errorMessage } from '../../lib/api';
import { formatMoney } from '../../../../shared/money';
import type { Page } from '../../../../shared/contracts';
import { useAuth } from '../auth/AuthContext';
import './catalog.css';

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  priceAdjustmentMinor: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  name: string;
  type: string;
  salesPriceMinor: number;
  costPriceMinor: number;
  notes: string | null;
  isActive: boolean;
  variants?: ProductVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  name: string;
  productId: string;
  priceMinor: number;
  interval: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  minimumQuantity: number;
  availableFrom: string | null;
  availableUntil: string | null;
  autoClose: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenew: boolean;
  isActive: boolean;
  product?: {
    id: string;
    name: string;
    salesPriceMinor: number;
    isActive: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TaxRule {
  id: string;
  name: string;
  rateBps: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountRule {
  id: string;
  name: string;
  kind: 'FIXED' | 'PERCENTAGE';
  scope: 'PRODUCT' | 'SUBSCRIPTION';
  value: number;
  productId: string | null;
  product?: {
    id: string;
    name: string;
    salesPriceMinor: number;
  };
  minimumPurchaseMinor: number;
  minimumQuantity: number;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  uses: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProductFormData {
  name: string;
  type: string;
  salesPrice: string;
  costPrice: string;
  notes: string;
  isActive: boolean;
}

interface VariantFormData {
  name: string;
  priceAdjustment: string;
  isActive: boolean;
}

interface PlanFormData {
  name: string;
  productId: string;
  price: string;
  interval: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  minimumQuantity: number;
  availableFrom: string;
  availableUntil: string;
  autoClose: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenew: boolean;
  isActive: boolean;
}

interface TaxFormData {
  name: string;
  ratePercent: string;
  isActive: boolean;
}

interface DiscountFormData {
  name: string;
  kind: 'FIXED' | 'PERCENTAGE';
  scope: 'PRODUCT' | 'SUBSCRIPTION';
  value: string;
  productId: string;
  minimumPurchase: string;
  minimumQuantity: number;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  isActive: boolean;
}

const initialProductFormData: ProductFormData = {
  name: '',
  type: 'SOFTWARE',
  salesPrice: '',
  costPrice: '0',
  notes: '',
  isActive: true,
};

const initialVariantFormData: VariantFormData = {
  name: '',
  priceAdjustment: '0',
  isActive: true,
};

const initialPlanFormData: PlanFormData = {
  name: '',
  productId: '',
  price: '',
  interval: 'MONTHLY',
  minimumQuantity: 1,
  availableFrom: '',
  availableUntil: '',
  autoClose: true,
  allowEarlyClose: true,
  allowPause: false,
  allowRenew: true,
  isActive: true,
};

const initialTaxFormData: TaxFormData = {
  name: '',
  ratePercent: '18',
  isActive: true,
};

const initialDiscountFormData: DiscountFormData = {
  name: '',
  kind: 'PERCENTAGE',
  scope: 'SUBSCRIPTION',
  value: '10',
  productId: '',
  minimumPurchase: '0',
  minimumQuantity: 1,
  startsAt: new Date().toISOString().slice(0, 10),
  endsAt: '',
  usageLimit: '',
  isActive: true,
};

export function CatalogPage() {
  const canEdit = useAuth().user?.role === 'ADMIN';
  const [activeTab, setActiveTab] = useState<'products' | 'plans' | 'taxes' | 'discounts'>('products');

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(10);
  const [productTotal, setProductTotal] = useState(0);
  const [productSearch, setProductSearch] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState('');
  const [productStatusFilter, setProductStatusFilter] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  // Plans state
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planPage, setPlanPage] = useState(1);
  const [planPageSize, setPlanPageSize] = useState(10);
  const [planTotal, setPlanTotal] = useState(0);
  const [planSearch, setPlanSearch] = useState('');
  const [planIntervalFilter, setPlanIntervalFilter] = useState('');
  const [planStatusFilter, setPlanStatusFilter] = useState('');
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);

  // Tax Rules state
  const [taxes, setTaxes] = useState<TaxRule[]>([]);
  const [taxPage, setTaxPage] = useState(1);
  const [taxPageSize, setTaxPageSize] = useState(10);
  const [taxTotal, setTaxTotal] = useState(0);
  const [taxSearch, setTaxSearch] = useState('');
  const [taxStatusFilter, setTaxStatusFilter] = useState('');
  const [taxesLoading, setTaxesLoading] = useState(true);
  const [taxesError, setTaxesError] = useState<string | null>(null);

  // Discount Rules state
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [discountPage, setDiscountPage] = useState(1);
  const [discountPageSize, setDiscountPageSize] = useState(10);
  const [discountTotal, setDiscountTotal] = useState(0);
  const [discountSearch, setDiscountSearch] = useState('');
  const [discountScopeFilter, setDiscountScopeFilter] = useState('');
  const [discountKindFilter, setDiscountKindFilter] = useState('');
  const [discountStatusFilter, setDiscountStatusFilter] = useState('');
  const [discountsLoading, setDiscountsLoading] = useState(true);
  const [discountsError, setDiscountsError] = useState<string | null>(null);

  // Modals state
  const [productModalMode, setProductModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productFormData, setProductFormData] = useState<ProductFormData>(initialProductFormData);

  const [variantModalMode, setVariantModalMode] = useState<'create' | 'edit' | null>(null);
  const [variantTargetProduct, setVariantTargetProduct] = useState<Product | null>(null);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [variantFormData, setVariantFormData] = useState<VariantFormData>(initialVariantFormData);

  const [planModalMode, setPlanModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planFormData, setPlanFormData] = useState<PlanFormData>(initialPlanFormData);

  const [taxModalMode, setTaxModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingTax, setEditingTax] = useState<TaxRule | null>(null);
  const [taxFormData, setTaxFormData] = useState<TaxFormData>(initialTaxFormData);

  const [discountModalMode, setDiscountModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingDiscount, setEditingDiscount] = useState<DiscountRule | null>(null);
  const [discountFormData, setDiscountFormData] = useState<DiscountFormData>(initialDiscountFormData);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Pricing Rule Preview modal / state
  const [showPricingCalc, setShowPricingCalc] = useState(false);
  const [calcPlanId, setCalcPlanId] = useState('');
  const [calcAddonProductId, setCalcAddonProductId] = useState('');
  const [calcResult, setCalcResult] = useState<any>(null);

  // Discount Preview live eligibility state
  const [showDiscountCalc, setShowDiscountCalc] = useState(false);
  const [previewDiscountProductId, setPreviewDiscountProductId] = useState('');
  const [previewDiscountQty, setPreviewDiscountQty] = useState(1);
  const [discountPreviewResult, setDiscountPreviewResult] = useState<any>(null);

  // ---------------------------------------------------------------------------
  // Data Loaders
  // ---------------------------------------------------------------------------

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(productPage));
      params.set('pageSize', String(productPageSize));
      if (productSearch.trim()) params.set('search', productSearch.trim());
      if (productTypeFilter) params.set('type', productTypeFilter);
      if (productStatusFilter === 'active') params.set('isActive', 'true');
      if (productStatusFilter === 'inactive') params.set('isActive', 'false');

      const res = await api<Page<Product>>(`/catalog/products?${params.toString()}`);
      setProducts(res.items);
      setProductTotal(res.total);
    } catch (err: unknown) {
      setProductsError(errorMessage(err));
    } finally {
      setProductsLoading(false);
    }
  }, [productPage, productPageSize, productSearch, productTypeFilter, productStatusFilter]);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(planPage));
      params.set('pageSize', String(planPageSize));
      if (planSearch.trim()) params.set('search', planSearch.trim());
      if (planIntervalFilter) params.set('interval', planIntervalFilter);
      if (planStatusFilter === 'active') params.set('isActive', 'true');
      if (planStatusFilter === 'inactive') params.set('isActive', 'false');

      const res = await api<Page<Plan>>(`/catalog/plans?${params.toString()}`);
      setPlans(res.items);
      setPlanTotal(res.total);
    } catch (err: unknown) {
      setPlansError(errorMessage(err));
    } finally {
      setPlansLoading(false);
    }
  }, [planPage, planPageSize, planSearch, planIntervalFilter, planStatusFilter]);

  const loadTaxes = useCallback(async () => {
    setTaxesLoading(true);
    setTaxesError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(taxPage));
      params.set('pageSize', String(taxPageSize));
      if (taxSearch.trim()) params.set('search', taxSearch.trim());
      if (taxStatusFilter === 'active') params.set('isActive', 'true');
      if (taxStatusFilter === 'inactive') params.set('isActive', 'false');

      const res = await api<Page<TaxRule>>(`/catalog/taxes?${params.toString()}`);
      setTaxes(res.items);
      setTaxTotal(res.total);
    } catch (err: unknown) {
      setTaxesError(errorMessage(err));
    } finally {
      setTaxesLoading(false);
    }
  }, [taxPage, taxPageSize, taxSearch, taxStatusFilter]);

  const loadDiscounts = useCallback(async () => {
    setDiscountsLoading(true);
    setDiscountsError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(discountPage));
      params.set('pageSize', String(discountPageSize));
      if (discountSearch.trim()) params.set('search', discountSearch.trim());
      if (discountScopeFilter) params.set('scope', discountScopeFilter);
      if (discountKindFilter) params.set('kind', discountKindFilter);
      if (discountStatusFilter === 'active') params.set('isActive', 'true');
      if (discountStatusFilter === 'inactive') params.set('isActive', 'false');

      const res = await api<Page<DiscountRule>>(`/catalog/discounts?${params.toString()}`);
      setDiscounts(res.items);
      setDiscountTotal(res.total);
    } catch (err: unknown) {
      setDiscountsError(errorMessage(err));
    } finally {
      setDiscountsLoading(false);
    }
  }, [discountPage, discountPageSize, discountSearch, discountScopeFilter, discountKindFilter, discountStatusFilter]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (activeTab === 'plans') {
      loadPlans();
    } else if (activeTab === 'taxes') {
      loadTaxes();
    } else if (activeTab === 'discounts') {
      loadDiscounts();
    }
  }, [activeTab, loadPlans, loadTaxes, loadDiscounts]);

  // ---------------------------------------------------------------------------
  // Product Modal & Archive Handlers
  // ---------------------------------------------------------------------------

  const openCreateProduct = () => {
    setEditingProduct(null);
    setProductFormData(initialProductFormData);
    setFormError(null);
    setProductModalMode('create');
  };

  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProductFormData({
      name: product.name,
      type: product.type,
      salesPrice: (product.salesPriceMinor / 100).toFixed(2),
      costPrice: (product.costPriceMinor / 100).toFixed(2),
      notes: product.notes || '',
      isActive: product.isActive,
    });
    setFormError(null);
    setProductModalMode('edit');
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = productFormData.name.trim();
    if (!trimmedName) {
      setFormError('Product name is required.');
      return;
    }

    const salesNum = parseFloat(productFormData.salesPrice);
    if (isNaN(salesNum) || salesNum < 0) {
      setFormError('Sales price must be a valid non-negative number.');
      return;
    }

    const costNum = parseFloat(productFormData.costPrice);
    if (isNaN(costNum) || costNum < 0) {
      setFormError('Cost price must be a valid non-negative number.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        type: productFormData.type.trim(),
        salesPriceMinor: Math.round(salesNum * 100),
        costPriceMinor: Math.round(costNum * 100),
        notes: productFormData.notes.trim() || null,
        isActive: productFormData.isActive,
      };

      if (productModalMode === 'create') {
        await api('/catalog/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Product "${trimmedName}" created successfully.`);
      } else if (productModalMode === 'edit' && editingProduct) {
        await api(`/catalog/products/${editingProduct.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Product "${trimmedName}" updated successfully.`);
      }

      setProductModalMode(null);
      loadProducts();
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleProductArchive = async (product: Product) => {
    const action = product.isActive ? 'archive' : 'unarchive';
    if (!window.confirm(`Are you sure you want to ${action} product "${product.name}"? Historical subscriptions and quotations will be preserved.`)) {
      return;
    }
    try {
      await api(`/catalog/products/${product.id}/${action}`, { method: 'POST' });
      setSuccessMessage(`Product "${product.name}" ${product.isActive ? 'archived' : 'restored'} successfully.`);
      loadProducts();
    } catch (err: unknown) {
      alert(`Failed to ${action} product: ${errorMessage(err)}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Variant Modal Handlers
  // ---------------------------------------------------------------------------

  const openCreateVariant = (product: Product) => {
    setVariantTargetProduct(product);
    setEditingVariant(null);
    setVariantFormData(initialVariantFormData);
    setFormError(null);
    setVariantModalMode('create');
  };

  const openEditVariant = (product: Product, variant: ProductVariant) => {
    setVariantTargetProduct(product);
    setEditingVariant(variant);
    setVariantFormData({
      name: variant.name,
      priceAdjustment: (variant.priceAdjustmentMinor / 100).toFixed(2),
      isActive: variant.isActive,
    });
    setFormError(null);
    setVariantModalMode('edit');
  };

  const handleVariantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = variantFormData.name.trim();
    if (!trimmedName) {
      setFormError('Variant name is required.');
      return;
    }

    const adjNum = parseFloat(variantFormData.priceAdjustment);
    if (isNaN(adjNum)) {
      setFormError('Price adjustment must be a valid number.');
      return;
    }

    if (!variantTargetProduct) return;

    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        priceAdjustmentMinor: Math.round(adjNum * 100),
        isActive: variantFormData.isActive,
      };

      if (variantModalMode === 'create') {
        await api(`/catalog/products/${variantTargetProduct.id}/variants`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Variant "${trimmedName}" added to product "${variantTargetProduct.name}".`);
      } else if (variantModalMode === 'edit' && editingVariant) {
        await api(`/catalog/products/${variantTargetProduct.id}/variants/${editingVariant.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Variant "${trimmedName}" updated.`);
      }

      setVariantModalMode(null);
      loadProducts();
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Plan Modal & Archive Handlers
  // ---------------------------------------------------------------------------

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanFormData(initialPlanFormData);
    setFormError(null);
    setPlanModalMode('create');
  };

  const openEditPlan = (plan: Plan) => {
    setEditingPlan(plan);
    setPlanFormData({
      name: plan.name,
      productId: plan.productId,
      price: (plan.priceMinor / 100).toFixed(2),
      interval: plan.interval,
      minimumQuantity: plan.minimumQuantity,
      availableFrom: plan.availableFrom ? plan.availableFrom.slice(0, 10) : '',
      availableUntil: plan.availableUntil ? plan.availableUntil.slice(0, 10) : '',
      autoClose: plan.autoClose,
      allowEarlyClose: plan.allowEarlyClose,
      allowPause: plan.allowPause,
      allowRenew: plan.allowRenew,
      isActive: plan.isActive,
    });
    setFormError(null);
    setPlanModalMode('edit');
  };

  const handlePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = planFormData.name.trim();
    if (!trimmedName) {
      setFormError('Plan name is required.');
      return;
    }

    if (!planFormData.productId) {
      setFormError('Linked primary product is required.');
      return;
    }

    const priceNum = parseFloat(planFormData.price);
    if (isNaN(priceNum) || priceNum < 0) {
      setFormError('Plan price must be a non-negative number.');
      return;
    }

    if (planFormData.availableFrom && planFormData.availableUntil && planFormData.availableUntil < planFormData.availableFrom) {
      setFormError('Available Until date must be on or after Available From date.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        productId: planFormData.productId,
        priceMinor: Math.round(priceNum * 100),
        interval: planFormData.interval,
        minimumQuantity: Math.max(1, planFormData.minimumQuantity),
        availableFrom: planFormData.availableFrom || null,
        availableUntil: planFormData.availableUntil || null,
        autoClose: planFormData.autoClose,
        allowEarlyClose: planFormData.allowEarlyClose,
        allowPause: planFormData.allowPause,
        allowRenew: planFormData.allowRenew,
        isActive: planFormData.isActive,
      };

      if (planModalMode === 'create') {
        await api('/catalog/plans', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Plan "${trimmedName}" created successfully.`);
      } else if (planModalMode === 'edit' && editingPlan) {
        await api(`/catalog/plans/${editingPlan.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Plan "${trimmedName}" updated successfully.`);
      }

      setPlanModalMode(null);
      loadPlans();
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const togglePlanArchive = async (plan: Plan) => {
    const action = plan.isActive ? 'archive' : 'unarchive';
    if (!window.confirm(`Are you sure you want to ${action} plan "${plan.name}"? Subscriptions referencing this plan will remain valid.`)) {
      return;
    }
    try {
      await api(`/catalog/plans/${plan.id}/${action}`, { method: 'POST' });
      setSuccessMessage(`Plan "${plan.name}" ${plan.isActive ? 'archived' : 'restored'} successfully.`);
      loadPlans();
    } catch (err: unknown) {
      alert(`Failed to ${action} plan: ${errorMessage(err)}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Tax Rule Modal & Archive Handlers
  // ---------------------------------------------------------------------------

  const openCreateTax = () => {
    setEditingTax(null);
    setTaxFormData(initialTaxFormData);
    setFormError(null);
    setTaxModalMode('create');
  };

  const openEditTax = (tax: TaxRule) => {
    setEditingTax(tax);
    setTaxFormData({
      name: tax.name,
      ratePercent: (tax.rateBps / 100).toString(),
      isActive: tax.isActive,
    });
    setFormError(null);
    setTaxModalMode('edit');
  };

  const handleTaxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = taxFormData.name.trim();
    if (!trimmedName) {
      setFormError('Tax rule name is required.');
      return;
    }

    const pct = parseFloat(taxFormData.ratePercent);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setFormError('Tax rate percentage must be a valid number between 0% and 100%.');
      return;
    }

    const rateBps = Math.round(pct * 100);

    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        rateBps,
        isActive: taxFormData.isActive,
      };

      if (taxModalMode === 'create') {
        await api('/catalog/taxes', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Tax rule "${trimmedName}" (${pct}%) created successfully.`);
      } else if (taxModalMode === 'edit' && editingTax) {
        await api(`/catalog/taxes/${editingTax.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Tax rule "${trimmedName}" (${pct}%) updated successfully.`);
      }

      setTaxModalMode(null);
      loadTaxes();
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTaxArchive = async (tax: TaxRule) => {
    const action = tax.isActive ? 'archive' : 'unarchive';
    if (!window.confirm(`Are you sure you want to ${action} tax rule "${tax.name}"? Existing invoices and subscription lines snapshotting this rate will be preserved.`)) {
      return;
    }
    try {
      await api(`/catalog/taxes/${tax.id}/${action}`, { method: 'POST' });
      setSuccessMessage(`Tax rule "${tax.name}" ${tax.isActive ? 'archived' : 'restored'} successfully.`);
      loadTaxes();
    } catch (err: unknown) {
      alert(`Failed to ${action} tax rule: ${errorMessage(err)}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Discount Rule Modal & Archive Handlers (Step 5)
  // ---------------------------------------------------------------------------

  const openCreateDiscount = () => {
    setEditingDiscount(null);
    setDiscountFormData(initialDiscountFormData);
    setFormError(null);
    setDiscountModalMode('create');
  };

  const openEditDiscount = (discount: DiscountRule) => {
    setEditingDiscount(discount);
    setDiscountFormData({
      name: discount.name,
      kind: discount.kind,
      scope: discount.scope,
      value: discount.kind === 'PERCENTAGE'
        ? (discount.value / 100).toString()
        : (discount.value / 100).toFixed(2),
      productId: discount.productId || '',
      minimumPurchase: (discount.minimumPurchaseMinor / 100).toFixed(2),
      minimumQuantity: discount.minimumQuantity,
      startsAt: discount.startsAt ? discount.startsAt.slice(0, 10) : '',
      endsAt: discount.endsAt ? discount.endsAt.slice(0, 10) : '',
      usageLimit: discount.usageLimit !== null ? String(discount.usageLimit) : '',
      isActive: discount.isActive,
    });
    setFormError(null);
    setDiscountModalMode('edit');
  };

  const handleDiscountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = discountFormData.name.trim();
    if (!trimmedName) {
      setFormError('Discount name is required.');
      return;
    }

    const valNum = parseFloat(discountFormData.value);
    if (isNaN(valNum) || valNum < 0) {
      setFormError('Discount value must be a valid positive number.');
      return;
    }

    if (discountFormData.kind === 'PERCENTAGE' && valNum > 100) {
      setFormError('Percentage discount cannot exceed 100%.');
      return;
    }

    if (discountFormData.scope === 'PRODUCT' && !discountFormData.productId) {
      setFormError('Target product must be selected for product-scoped discounts.');
      return;
    }

    if (!discountFormData.startsAt) {
      setFormError('Start date is required.');
      return;
    }

    if (discountFormData.endsAt && discountFormData.endsAt < discountFormData.startsAt) {
      setFormError('End date must be on or after start date.');
      return;
    }

    const minPurchaseNum = parseFloat(discountFormData.minimumPurchase) || 0;
    const usageLimitVal = discountFormData.usageLimit.trim() ? parseInt(discountFormData.usageLimit, 10) : null;

    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        kind: discountFormData.kind,
        scope: discountFormData.scope,
        value: discountFormData.kind === 'PERCENTAGE' ? Math.round(valNum * 100) : Math.round(valNum * 100),
        productId: discountFormData.scope === 'PRODUCT' ? discountFormData.productId : null,
        minimumPurchaseMinor: Math.round(minPurchaseNum * 100),
        minimumQuantity: Math.max(1, discountFormData.minimumQuantity),
        startsAt: discountFormData.startsAt,
        endsAt: discountFormData.endsAt || null,
        usageLimit: usageLimitVal,
        isActive: discountFormData.isActive,
      };

      if (discountModalMode === 'create') {
        await api('/catalog/discounts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Discount rule "${trimmedName}" created successfully.`);
      } else if (discountModalMode === 'edit' && editingDiscount) {
        await api(`/catalog/discounts/${editingDiscount.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Discount rule "${trimmedName}" updated successfully.`);
      }

      setDiscountModalMode(null);
      loadDiscounts();
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDiscountArchive = async (discount: DiscountRule) => {
    const action = discount.isActive ? 'archive' : 'unarchive';
    if (!window.confirm(`Are you sure you want to ${action} discount "${discount.name}"? Historical invoice redemption snapshots will be preserved.`)) {
      return;
    }
    try {
      await api(`/catalog/discounts/${discount.id}/${action}`, { method: 'POST' });
      setSuccessMessage(`Discount rule "${discount.name}" ${discount.isActive ? 'archived' : 'restored'} successfully.`);
      loadDiscounts();
    } catch (err: unknown) {
      alert(`Failed to ${action} discount rule: ${errorMessage(err)}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Pricing Calculation & Discount Preview Engines
  // ---------------------------------------------------------------------------

  const runPricingCalc = async () => {
    if (!calcPlanId) {
      alert('Please select a plan for line 1');
      return;
    }
    try {
      const selectedPlan = plans.find(p => p.id === calcPlanId);
      if (!selectedPlan) return;

      const lines: any[] = [
        {
          productId: selectedPlan.productId,
          quantity: selectedPlan.minimumQuantity,
        },
      ];

      if (calcAddonProductId) {
        lines.push({
          productId: calcAddonProductId,
          quantity: 1,
        });
      }

      const res = await api('/catalog/pricing/calculate', {
        method: 'POST',
        body: JSON.stringify({
          planId: calcPlanId,
          lines,
        }),
      });
      setCalcResult(res);
    } catch (err: unknown) {
      alert(`Pricing calculation failed: ${errorMessage(err)}`);
    }
  };

  const runDiscountPreview = async () => {
    if (!previewDiscountProductId && products.length === 0) {
      alert('Please select a product to preview discount eligibility.');
      return;
    }
    const targetProd = products.find(p => p.id === previewDiscountProductId) || products[0];
    if (!targetProd) return;

    try {
      const res = await api<any>('/catalog/discounts/preview', {
        method: 'POST',
        body: JSON.stringify({
          lines: [
            {
              productId: targetProd.id,
              quantity: Math.max(1, previewDiscountQty),
              unitPriceMinor: targetProd.salesPriceMinor,
              taxRateBps: 1800,
            },
          ],
        }),
      });
      setDiscountPreviewResult(res);
    } catch (err: unknown) {
      alert(`Discount preview failed: ${errorMessage(err)}`);
    }
  };

  const productTotalPages = Math.max(1, Math.ceil(productTotal / productPageSize));
  const planTotalPages = Math.max(1, Math.ceil(planTotal / planPageSize));
  const taxTotalPages = Math.max(1, Math.ceil(taxTotal / taxPageSize));
  const discountTotalPages = Math.max(1, Math.ceil(discountTotal / discountPageSize));

  return (
    <div className="catalog-container">
      {/* Header */}
      <div className="catalog-header">
        <div>
          <span className="eyebrow">CATALOG & BUSINESS CONFIGURATION</span>
          <h1>Product Catalog & Business Rules</h1>
          <p className="muted">
            Manage your subscription products, recurring billing plans, lifecycle policies, tax rules, and promotional discounts.
          </p>
        </div>
        <div className="catalog-header-actions">
          {activeTab === 'products' && (
            <button
              type="button"
              className="catalog-btn catalog-btn-primary"
              hidden={!canEdit} onClick={openCreateProduct}
            >
              + Add Product
            </button>
          )}
          {activeTab === 'plans' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary"
                onClick={() => {
                  setShowPricingCalc(!showPricingCalc);
                  if (!calcPlanId && plans.length > 0) setCalcPlanId(plans[0].id);
                }}
              >
                {showPricingCalc ? 'Hide Pricing Rule' : 'Preview Pricing Rule'}
              </button>
              <button
                type="button"
                className="catalog-btn catalog-btn-primary"
                hidden={!canEdit} onClick={openCreatePlan}
              >
                + Add Plan
              </button>
            </div>
          )}
          {activeTab === 'taxes' && (
            <button
              type="button"
              className="catalog-btn catalog-btn-primary"
              hidden={!canEdit} onClick={openCreateTax}
            >
              + Add Tax Rule
            </button>
          )}
          {activeTab === 'discounts' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary"
                onClick={() => {
                  setShowDiscountCalc(!showDiscountCalc);
                  if (!previewDiscountProductId && products.length > 0) setPreviewDiscountProductId(products[0].id);
                }}
              >
                {showDiscountCalc ? 'Hide Eligibility Preview' : 'Preview Eligibility'}
              </button>
              <button
                type="button"
                className="catalog-btn catalog-btn-primary"
                hidden={!canEdit} onClick={openCreateDiscount}
              >
                + Add Discount Rule
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="catalog-tabs">
        <button
          type="button"
          className={`catalog-tab ${activeTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveTab('products')}
        >
          Products & Variants
          <span className="catalog-tab-badge">Step 1 & 2</span>
        </button>
        <button
          type="button"
          className={`catalog-tab ${activeTab === 'plans' ? 'active' : ''}`}
          onClick={() => setActiveTab('plans')}
        >
          Recurring Plans & Lifecycle
          <span className="catalog-tab-badge">Step 2 & 3</span>
        </button>
        <button
          type="button"
          className={`catalog-tab ${activeTab === 'taxes' ? 'active' : ''}`}
          onClick={() => setActiveTab('taxes')}
        >
          Tax Rules
          <span className="catalog-tab-badge">Step 4</span>
        </button>
        <button
          type="button"
          className={`catalog-tab ${activeTab === 'discounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('discounts')}
        >
          Discounts
          <span className="catalog-tab-badge">Step 5</span>
        </button>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="alert-success">
          ✓ {successMessage}
        </div>
      )}

      {/* Pricing Rule Preview Banner */}
      {showPricingCalc && (
        <div className="pricing-calc-box">
          <div className="pricing-calc-header">
            <div>
              <span className="pricing-rule-badge">AGREED PRIMARY-LINE PRICING RULE</span>
              <h2 style={{ margin: '8px 0 4px' }}>Multi-line Pricing Engine Demonstration</h2>
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                Primary line: <code>Plan.priceMinor + variant adjustment</code> · Add-on lines: <code>Product.salesPriceMinor + variant adjustment</code> · Plan fee is never charged twice.
              </p>
            </div>
            <button
              type="button"
              className="catalog-btn catalog-btn-primary catalog-btn-small"
              onClick={runPricingCalc}
            >
              Calculate Live
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="form-group">
              <label>Select Plan (Primary Line):</label>
              <select
                className="catalog-select"
                value={calcPlanId}
                onChange={(e) => setCalcPlanId(e.target.value)}
              >
                {plans.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.interval} · {formatMoney(p.priceMinor)})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Select Add-on Product (Line 2):</label>
              <select
                className="catalog-select"
                value={calcAddonProductId}
                onChange={(e) => setCalcAddonProductId(e.target.value)}
              >
                <option value="">No add-on line</option>
                {products.map(prod => (
                  <option key={prod.id} value={prod.id}>
                    {prod.name} ({formatMoney(prod.salesPriceMinor)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {calcResult && (
            <div style={{ background: '#f9fbf9', padding: '14px 18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <strong>Pricing Breakdown for {calcResult.data.planName}:</strong>
              <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '0.85rem' }}>
                {calcResult.data.lines.map((l: any, i: number) => (
                  <li key={i}>
                    {l.isPrimary ? 'Line 1 (Primary Line): ' : `Line ${i + 1} (Add-on Line): `}
                    <strong>{l.productName}</strong> × {l.quantity} units @ {formatMoney(l.unitPriceMinor)} = <strong>{formatMoney(l.subtotalMinor)}</strong>
                    <span className="muted" style={{ marginLeft: '8px' }}>
                      ({l.isPrimary ? 'uses Plan base price' : 'uses Product sales price'})
                    </span>
                  </li>
                ))}
              </ul>
              <div style={{ fontSize: '0.95rem', fontWeight: 650, color: 'var(--green)' }}>
                Total Subtotal: {formatMoney(calcResult.data.subtotalMinor)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Discount Eligibility Live Preview Banner */}
      {showDiscountCalc && (
        <div className="pricing-calc-box">
          <div className="pricing-calc-header">
            <div>
              <span className="pricing-rule-badge">DETERMINISTIC 1-DISCOUNT SELECTION POLICY</span>
              <h2 style={{ margin: '8px 0 4px' }}>Read-only Discount Eligibility Preview</h2>
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                Evaluates active candidate discount rules and deterministically selects the single highest savings. Actual redemption is transacted atomically by Member 4 upon invoice generation.
              </p>
            </div>
            <button
              type="button"
              className="catalog-btn catalog-btn-primary catalog-btn-small"
              onClick={runDiscountPreview}
            >
              Check Live Eligibility
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
            <div className="form-group">
              <label>Select Product to Test:</label>
              <select
                className="catalog-select"
                value={previewDiscountProductId}
                onChange={(e) => setPreviewDiscountProductId(e.target.value)}
              >
                {products.map(prod => (
                  <option key={prod.id} value={prod.id}>
                    {prod.name} ({formatMoney(prod.salesPriceMinor)})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Quantity:</label>
              <input
                type="number"
                min="1"
                className="form-input"
                value={previewDiscountQty}
                onChange={(e) => setPreviewDiscountQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
          </div>

          {discountPreviewResult && (
            <div style={{ background: '#f9fbf9', padding: '14px 18px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              {discountPreviewResult.data.eligible ? (
                <div>
                  <span className="type-pill" style={{ background: '#e6f4ea', color: '#137333', fontWeight: 700 }}>
                    ✓ Eligible: {discountPreviewResult.data.selectedDiscount.name}
                  </span>
                  <div style={{ marginTop: '8px', fontSize: '0.9rem' }}>
                    Savings: <strong>{formatMoney(discountPreviewResult.data.savingsMinor)}</strong> ({discountPreviewResult.data.selectedDiscount.kind} {discountPreviewResult.data.selectedDiscount.scope})
                  </div>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.78rem' }}>
                    {discountPreviewResult.data.policy}
                  </p>
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
                  ℹ {discountPreviewResult.data.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 1: PRODUCTS & VARIANTS                                            */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'products' && (
        <>
          <div className="catalog-toolbar">
            <div className="catalog-filters">
              <input
                type="search"
                placeholder="Search products by name..."
                className="catalog-search-input"
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setProductPage(1);
                }}
              />
              <select
                className="catalog-select"
                value={productTypeFilter}
                onChange={(e) => {
                  setProductTypeFilter(e.target.value);
                  setProductPage(1);
                }}
              >
                <option value="">All Types</option>
                <option value="SOFTWARE">Software</option>
                <option value="SERVICE">Service</option>
                <option value="HARDWARE">Hardware</option>
              </select>
              <select
                className="catalog-select"
                value={productStatusFilter}
                onChange={(e) => {
                  setProductStatusFilter(e.target.value);
                  setProductPage(1);
                }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Archived Only</option>
              </select>
            </div>
            <div>
              <select
                className="catalog-select"
                value={productPageSize}
                onChange={(e) => {
                  setProductPageSize(Number(e.target.value));
                  setProductPage(1);
                }}
              >
                <option value="10">10 per page</option>
                <option value="20">20 per page</option>
                <option value="50">50 per page</option>
              </select>
            </div>
          </div>

          {productsLoading ? (
            <div className="panel empty-state">
              <span className="empty-symbol">⏳</span>
              <h2>Loading products...</h2>
              <p className="muted">Fetching catalog products and variants from the server.</p>
            </div>
          ) : productsError ? (
            <div className="panel alert-error">
              <div><strong>Unable to load products:</strong> {productsError}</div>
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                onClick={loadProducts}
              >
                Retry
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="panel empty-state">
              <span className="empty-symbol">📦</span>
              <h2>No products found</h2>
              <p className="muted">
                {productSearch || productTypeFilter || productStatusFilter
                  ? 'Try adjusting your search filters to find what you are looking for.'
                  : 'Start building your catalog by adding your first subscription product.'}
              </p>
              <div style={{ marginTop: '18px' }}>
                <button type="button" className="catalog-btn catalog-btn-primary" hidden={!canEdit} onClick={openCreateProduct}>
                  + Add First Product
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="catalog-table-wrapper">
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>Product & Variants</th>
                      <th>Type</th>
                      <th>Sales Price</th>
                      <th>Cost Price</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <div className="product-name">{product.name}</div>
                          {product.notes && <div className="product-notes">{product.notes}</div>}
                          
                          <div className="variant-chips">
                            {product.variants && product.variants.length > 0 ? (
                              product.variants.map((v) => (
                                <span
                                  key={v.id}
                                  className="variant-chip"
                                  onClick={canEdit ? () => openEditVariant(product, v) : undefined}
                                  title={canEdit ? 'Click to edit variant' : 'Product variant'}
                                >
                                  <strong>{v.name}</strong>: {v.priceAdjustmentMinor >= 0 ? '+' : ''}{formatMoney(v.priceAdjustmentMinor)}
                                  {!v.isActive && <span className="muted"> (inactive)</span>}
                                </span>
                              ))
                            ) : null}
                            <button
                              type="button"
                              className="add-variant-btn"
                              hidden={!canEdit} onClick={() => openCreateVariant(product)}
                            >
                              + Add Variant
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className="type-pill">{product.type}</span>
                        </td>
                        <td>
                          <strong>{formatMoney(product.salesPriceMinor)}</strong>
                        </td>
                        <td className="muted">
                          {formatMoney(product.costPriceMinor)}
                        </td>
                        <td>
                          <span className={`status-pill ${product.isActive ? 'active' : 'inactive'}`}>
                            ● {product.isActive ? 'Active' : 'Archived'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="catalog-btn catalog-btn-secondary catalog-btn-small"
                              hidden={!canEdit} onClick={() => openEditProduct(product)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="catalog-btn catalog-btn-secondary catalog-btn-small"
                              hidden={!canEdit} onClick={() => toggleProductArchive(product)}
                              title={product.isActive ? 'Archive product to preserve history' : 'Restore product to active'}
                            >
                              {product.isActive ? 'Archive' : 'Restore'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="catalog-pagination">
                <div>
                  Showing page <strong>{productPage}</strong> of <strong>{productTotalPages}</strong> ({productTotal} total products)
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={productPage <= 1}
                    onClick={() => setProductPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={productPage >= productTotalPages}
                    onClick={() => setProductPage(p => Math.min(productTotalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 2: RECURRING PLANS & LIFECYCLE                                    */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'plans' && (
        <>
          <div className="catalog-toolbar">
            <div className="catalog-filters">
              <input
                type="search"
                placeholder="Search plans or product names..."
                className="catalog-search-input"
                value={planSearch}
                onChange={(e) => {
                  setPlanSearch(e.target.value);
                  setPlanPage(1);
                }}
              />
              <select
                className="catalog-select"
                value={planIntervalFilter}
                onChange={(e) => {
                  setPlanIntervalFilter(e.target.value);
                  setPlanPage(1);
                }}
              >
                <option value="">All Intervals</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
              <select
                className="catalog-select"
                value={planStatusFilter}
                onChange={(e) => {
                  setPlanStatusFilter(e.target.value);
                  setPlanPage(1);
                }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Archived Only</option>
              </select>
            </div>
            <div>
              <select
                className="catalog-select"
                value={planPageSize}
                onChange={(e) => {
                  setPlanPageSize(Number(e.target.value));
                  setPlanPage(1);
                }}
              >
                <option value="10">10 per page</option>
                <option value="20">20 per page</option>
                <option value="50">50 per page</option>
              </select>
            </div>
          </div>

          {plansLoading ? (
            <div className="panel empty-state">
              <span className="empty-symbol">⏳</span>
              <h2>Loading recurring plans...</h2>
              <p className="muted">Fetching plans, lifecycle policies, and linked product details.</p>
            </div>
          ) : plansError ? (
            <div className="panel alert-error">
              <div><strong>Unable to load plans:</strong> {plansError}</div>
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                onClick={loadPlans}
              >
                Retry
              </button>
            </div>
          ) : plans.length === 0 ? (
            <div className="panel empty-state">
              <span className="empty-symbol">📋</span>
              <h2>No recurring plans found</h2>
              <p className="muted">Create your first recurring subscription plan linked to a product.</p>
              <div style={{ marginTop: '18px' }}>
                <button type="button" className="catalog-btn catalog-btn-primary" hidden={!canEdit} onClick={openCreatePlan}>
                  + Create First Plan
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="catalog-table-wrapper">
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>Plan Name</th>
                      <th>Linked Product</th>
                      <th>Interval</th>
                      <th>Plan Fee</th>
                      <th>Min Qty</th>
                      <th>Availability Window</th>
                      <th>Lifecycle Policies</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((plan) => (
                      <tr key={plan.id}>
                        <td>
                          <strong>{plan.name}</strong>
                        </td>
                        <td>
                          {plan.product?.name || <span className="muted">None</span>}
                        </td>
                        <td>
                          <span className="interval-pill">{plan.interval}</span>
                        </td>
                        <td>
                          <strong>{formatMoney(plan.priceMinor)}</strong>
                        </td>
                        <td>
                          {plan.minimumQuantity} units
                        </td>
                        <td className="muted" style={{ fontSize: '0.82rem' }}>
                          {plan.availableFrom || plan.availableUntil ? (
                            `${plan.availableFrom ? plan.availableFrom.slice(0, 10) : 'Any'} → ${plan.availableUntil ? plan.availableUntil.slice(0, 10) : 'Ongoing'}`
                          ) : (
                            'Always available'
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '180px' }}>
                            <span className="type-pill" style={{ fontSize: '0.68rem', background: plan.autoClose ? '#e6f4ea' : '#f1f3f4' }}>
                              AutoClose: {plan.autoClose ? 'Yes' : 'No'}
                            </span>
                            <span className="type-pill" style={{ fontSize: '0.68rem', background: plan.allowEarlyClose ? '#e6f4ea' : '#f1f3f4' }}>
                              EarlyClose: {plan.allowEarlyClose ? 'Yes' : 'No'}
                            </span>
                            <span className="type-pill" style={{ fontSize: '0.68rem', background: plan.allowPause ? '#e6f4ea' : '#f1f3f4' }}>
                              Pause: {plan.allowPause ? 'Yes' : 'No'}
                            </span>
                            <span className="type-pill" style={{ fontSize: '0.68rem', background: plan.allowRenew ? '#e6f4ea' : '#f1f3f4' }}>
                              Renew: {plan.allowRenew ? 'Yes' : 'No'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${plan.isActive ? 'active' : 'inactive'}`}>
                            ● {plan.isActive ? 'Active' : 'Archived'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="catalog-btn catalog-btn-secondary catalog-btn-small"
                              hidden={!canEdit} onClick={() => openEditPlan(plan)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="catalog-btn catalog-btn-secondary catalog-btn-small"
                              hidden={!canEdit} onClick={() => togglePlanArchive(plan)}
                              title={plan.isActive ? 'Archive plan to preserve history' : 'Restore plan to active'}
                            >
                              {plan.isActive ? 'Archive' : 'Restore'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="catalog-pagination">
                <div>
                  Showing page <strong>{planPage}</strong> of <strong>{planTotalPages}</strong> ({planTotal} total plans)
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={planPage <= 1}
                    onClick={() => setPlanPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={planPage >= planTotalPages}
                    onClick={() => setPlanPage(p => Math.min(planTotalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 3: TAX RULES                                                      */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'taxes' && (
        <>
          <div style={{ background: '#f8fafc', padding: '14px 18px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
            <strong>Tax Rule Rate Policy:</strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Tax rates are maintained as integer basis points (1% = 100 bps) to prevent decimal rounding discrepancies.
              Active tax rates are snapshotted onto subscription lines and quotation templates at creation time.
              Updating or archiving a tax rule applies to future calculations only and never alters existing invoices or historical transactions.
            </p>
          </div>

          <div className="catalog-toolbar">
            <div className="catalog-filters">
              <input
                type="search"
                placeholder="Search tax rules by name..."
                className="catalog-search-input"
                value={taxSearch}
                onChange={(e) => {
                  setTaxSearch(e.target.value);
                  setTaxPage(1);
                }}
              />
              <select
                className="catalog-select"
                value={taxStatusFilter}
                onChange={(e) => {
                  setTaxStatusFilter(e.target.value);
                  setTaxPage(1);
                }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Archived Only</option>
              </select>
            </div>
            <div>
              <select
                className="catalog-select"
                value={taxPageSize}
                onChange={(e) => {
                  setTaxPageSize(Number(e.target.value));
                  setTaxPage(1);
                }}
              >
                <option value="10">10 per page</option>
                <option value="20">20 per page</option>
                <option value="50">50 per page</option>
              </select>
            </div>
          </div>

          {taxesLoading ? (
            <div className="panel empty-state">
              <span className="empty-symbol">⏳</span>
              <h2>Loading tax rules...</h2>
              <p className="muted">Fetching tax rules and configured basis point rates.</p>
            </div>
          ) : taxesError ? (
            <div className="panel alert-error">
              <div><strong>Unable to load tax rules:</strong> {taxesError}</div>
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                onClick={loadTaxes}
              >
                Retry
              </button>
            </div>
          ) : taxes.length === 0 ? (
            <div className="panel empty-state">
              <span className="empty-symbol">⚖️</span>
              <h2>No tax rules found</h2>
              <p className="muted">Create your first tax rule (e.g. GST 18%, Exempt 0%, Standard 5%).</p>
              <div style={{ marginTop: '18px' }}>
                <button type="button" className="catalog-btn catalog-btn-primary" hidden={!canEdit} onClick={openCreateTax}>
                  + Create First Tax Rule
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="catalog-table-wrapper">
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>Rule Name</th>
                      <th>Rate Percentage</th>
                      <th>Stored Basis Points</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxes.map((tax) => {
                      const pctVal = tax.rateBps / 100;
                      const pctFormatted = tax.rateBps % 100 === 0 ? `${pctVal}%` : `${pctVal.toFixed(2)}%`;
                      return (
                        <tr key={tax.id}>
                          <td>
                            <strong>{tax.name}</strong>
                          </td>
                          <td>
                            <span className="type-pill" style={{ background: '#eaf4e9', color: '#17674f', fontWeight: 700 }}>
                              {pctFormatted}
                            </span>
                          </td>
                          <td className="muted" style={{ fontFamily: 'monospace' }}>
                            {tax.rateBps} bps
                          </td>
                          <td>
                            <span className={`status-pill ${tax.isActive ? 'active' : 'inactive'}`}>
                              ● {tax.isActive ? 'Active' : 'Archived'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                                hidden={!canEdit} onClick={() => openEditTax(tax)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                                hidden={!canEdit} onClick={() => toggleTaxArchive(tax)}
                                title={tax.isActive ? 'Archive tax rule to preserve subscription history' : 'Restore tax rule to active'}
                              >
                                {tax.isActive ? 'Archive' : 'Restore'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="catalog-pagination">
                <div>
                  Showing page <strong>{taxPage}</strong> of <strong>{taxTotalPages}</strong> ({taxTotal} total tax rules)
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={taxPage <= 1}
                    onClick={() => setTaxPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={taxPage >= taxTotalPages}
                    onClick={() => setTaxPage(p => Math.min(taxTotalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 4: DISCOUNT RULES (Step 5)                                        */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'discounts' && (
        <>
          <div style={{ background: '#f8fafc', padding: '14px 18px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
            <strong>Deterministic Single-Discount Policy:</strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Discounts are never stacked. On invoice confirmation, the system deterministically selects the single eligible active rule that produces the largest monetary savings.
              Product-scoped discounts require a valid product link; subscription-scoped discounts apply across the whole invoice.
            </p>
          </div>

          <div className="catalog-toolbar">
            <div className="catalog-filters">
              <input
                type="search"
                placeholder="Search discount rules by name..."
                className="catalog-search-input"
                value={discountSearch}
                onChange={(e) => {
                  setDiscountSearch(e.target.value);
                  setDiscountPage(1);
                }}
              />
              <select
                className="catalog-select"
                value={discountScopeFilter}
                onChange={(e) => {
                  setDiscountScopeFilter(e.target.value);
                  setDiscountPage(1);
                }}
              >
                <option value="">All Scopes</option>
                <option value="SUBSCRIPTION">Whole Subscription</option>
                <option value="PRODUCT">Product Specific</option>
              </select>
              <select
                className="catalog-select"
                value={discountKindFilter}
                onChange={(e) => {
                  setDiscountKindFilter(e.target.value);
                  setDiscountPage(1);
                }}
              >
                <option value="">All Types</option>
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="FIXED">Fixed Amount (₹)</option>
              </select>
              <select
                className="catalog-select"
                value={discountStatusFilter}
                onChange={(e) => {
                  setDiscountStatusFilter(e.target.value);
                  setDiscountPage(1);
                }}
              >
                <option value="">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Archived Only</option>
              </select>
            </div>
            <div>
              <select
                className="catalog-select"
                value={discountPageSize}
                onChange={(e) => {
                  setDiscountPageSize(Number(e.target.value));
                  setDiscountPage(1);
                }}
              >
                <option value="10">10 per page</option>
                <option value="20">20 per page</option>
                <option value="50">50 per page</option>
              </select>
            </div>
          </div>

          {discountsLoading ? (
            <div className="panel empty-state">
              <span className="empty-symbol">⏳</span>
              <h2>Loading discount rules...</h2>
              <p className="muted">Fetching discount configurations, thresholds, and usage limits.</p>
            </div>
          ) : discountsError ? (
            <div className="panel alert-error">
              <div><strong>Unable to load discounts:</strong> {discountsError}</div>
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                onClick={loadDiscounts}
              >
                Retry
              </button>
            </div>
          ) : discounts.length === 0 ? (
            <div className="panel empty-state">
              <span className="empty-symbol">🏷️</span>
              <h2>No discount rules found</h2>
              <p className="muted">Create your first fixed or percentage promotional discount rule.</p>
              <div style={{ marginTop: '18px' }}>
                <button type="button" className="catalog-btn catalog-btn-primary" hidden={!canEdit} onClick={openCreateDiscount}>
                  + Create First Discount
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="catalog-table-wrapper">
                <table className="catalog-table">
                  <thead>
                    <tr>
                      <th>Rule Name & Scope</th>
                      <th>Type & Savings Value</th>
                      <th>Thresholds</th>
                      <th>Validity Period</th>
                      <th>Uses / Limit</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map((discount) => {
                      const isPct = discount.kind === 'PERCENTAGE';
                      const valFormatted = isPct
                        ? `${(discount.value / 100).toFixed(discount.value % 100 === 0 ? 0 : 2)}% (${discount.value} bps)`
                        : `${formatMoney(discount.value)} (${discount.value} paise)`;

                      return (
                        <tr key={discount.id}>
                          <td>
                            <strong>{discount.name}</strong>
                            <div style={{ marginTop: '4px' }}>
                              <span className="type-pill" style={{ fontSize: '0.7rem' }}>
                                {discount.scope === 'PRODUCT'
                                  ? `Product: ${discount.product?.name || 'Selected Item'}`
                                  : 'Whole Subscription'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className="type-pill" style={{ background: '#eaf4e9', color: '#17674f', fontWeight: 700 }}>
                              {valFormatted}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.82rem' }}>
                            <div>Min Purchase: {formatMoney(discount.minimumPurchaseMinor)}</div>
                            <div className="muted">Min Qty: {discount.minimumQuantity} units</div>
                          </td>
                          <td className="muted" style={{ fontSize: '0.82rem' }}>
                            {discount.startsAt.slice(0, 10)} → {discount.endsAt ? discount.endsAt.slice(0, 10) : 'Ongoing'}
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>
                            <strong>{discount.uses}</strong> / {discount.usageLimit !== null ? discount.usageLimit : '∞'}
                          </td>
                          <td>
                            <span className={`status-pill ${discount.isActive ? 'active' : 'inactive'}`}>
                              ● {discount.isActive ? 'Active' : 'Archived'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                                hidden={!canEdit} onClick={() => openEditDiscount(discount)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                                hidden={!canEdit} onClick={() => toggleDiscountArchive(discount)}
                                title={discount.isActive ? 'Archive discount to preserve history' : 'Restore discount to active'}
                              >
                                {discount.isActive ? 'Archive' : 'Restore'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="catalog-pagination">
                <div>
                  Showing page <strong>{discountPage}</strong> of <strong>{discountTotalPages}</strong> ({discountTotal} total discount rules)
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={discountPage <= 1}
                    onClick={() => setDiscountPage(p => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="catalog-btn catalog-btn-secondary catalog-btn-small"
                    disabled={discountPage >= discountTotalPages}
                    onClick={() => setDiscountPage(p => Math.min(discountTotalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT PRODUCT                                          */}
      {/* --------------------------------------------------------------------- */}
      {productModalMode && (
        <div className="catalog-modal-backdrop" onClick={() => setProductModalMode(null)}>
          <div className="catalog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>{productModalMode === 'create' ? 'Create New Product' : `Edit: ${editingProduct?.name}`}</h2>
              <button type="button" className="catalog-close-btn" onClick={() => setProductModalMode(null)}>×</button>
            </div>
            <form onSubmit={handleProductSubmit} className="catalog-form">
              {formError && <div className="alert-error">{formError}</div>}
              <div className="form-group">
                <label>Product Name *</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  value={productFormData.name}
                  onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Product Type</label>
                <select
                  className="form-select"
                  value={productFormData.type}
                  onChange={(e) => setProductFormData({ ...productFormData, type: e.target.value })}
                >
                  <option value="SOFTWARE">Software</option>
                  <option value="SERVICE">Service</option>
                  <option value="HARDWARE">Hardware</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Sales Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className="form-input"
                    value={productFormData.salesPrice}
                    onChange={(e) => setProductFormData({ ...productFormData, salesPrice: e.target.value })}
                  />
                  <span className="form-help">Stored as paise: {Math.round((parseFloat(productFormData.salesPrice) || 0) * 100)}</span>
                </div>
                <div className="form-group">
                  <label>Cost Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    value={productFormData.costPrice}
                    onChange={(e) => setProductFormData({ ...productFormData, costPrice: e.target.value })}
                  />
                  <span className="form-help">Stored as paise: {Math.round((parseFloat(productFormData.costPrice) || 0) * 100)}</span>
                </div>
              </div>
              <div className="form-group">
                <label>Internal Notes</label>
                <textarea
                  rows={3}
                  className="form-textarea"
                  value={productFormData.notes}
                  onChange={(e) => setProductFormData({ ...productFormData, notes: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={productFormData.isActive}
                    onChange={(e) => setProductFormData({ ...productFormData, isActive: e.target.checked })}
                  />
                  <span>Product is active</span>
                </label>
              </div>
              <div className="catalog-modal-actions">
                <button type="button" className="catalog-btn catalog-btn-secondary" onClick={() => setProductModalMode(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="catalog-btn catalog-btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : productModalMode === 'create' ? 'Create Product' : 'Update Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT VARIANT                                          */}
      {/* --------------------------------------------------------------------- */}
      {variantModalMode && (
        <div className="catalog-modal-backdrop" onClick={() => setVariantModalMode(null)}>
          <div className="catalog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>{variantModalMode === 'create' ? `Add Variant for "${variantTargetProduct?.name}"` : `Edit Variant: ${editingVariant?.name}`}</h2>
              <button type="button" className="catalog-close-btn" onClick={() => setVariantModalMode(null)}>×</button>
            </div>
            <form onSubmit={handleVariantSubmit} className="catalog-form">
              {formError && <div className="alert-error">{formError}</div>}
              <div className="form-group">
                <label>Variant Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 5 Users, Enterprise Addon, Annual Billing"
                  className="form-input"
                  value={variantFormData.name}
                  onChange={(e) => setVariantFormData({ ...variantFormData, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Price Adjustment (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  className="form-input"
                  value={variantFormData.priceAdjustment}
                  onChange={(e) => setVariantFormData({ ...variantFormData, priceAdjustment: e.target.value })}
                />
                <span className="form-help">
                  Adjustment added to base price. Positive = Surcharge, Negative = Discount. (Paise: {Math.round((parseFloat(variantFormData.priceAdjustment) || 0) * 100)})
                </span>
              </div>
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={variantFormData.isActive}
                    onChange={(e) => setVariantFormData({ ...variantFormData, isActive: e.target.checked })}
                  />
                  <span>Variant is active</span>
                </label>
              </div>
              <div className="catalog-modal-actions">
                <button type="button" className="catalog-btn catalog-btn-secondary" onClick={() => setVariantModalMode(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="catalog-btn catalog-btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : variantModalMode === 'create' ? 'Add Variant' : 'Update Variant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT PLAN                                             */}
      {/* --------------------------------------------------------------------- */}
      {planModalMode && (
        <div className="catalog-modal-backdrop" onClick={() => setPlanModalMode(null)}>
          <div className="catalog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>{planModalMode === 'create' ? 'Create Recurring Plan' : `Edit Plan: ${editingPlan?.name}`}</h2>
              <button type="button" className="catalog-close-btn" onClick={() => setPlanModalMode(null)}>×</button>
            </div>
            <form onSubmit={handlePlanSubmit} className="catalog-form">
              {formError && <div className="alert-error">{formError}</div>}
              
              <div className="form-group">
                <label>Plan Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Pro Monthly Business Plan"
                  className="form-input"
                  value={planFormData.name}
                  onChange={(e) => setPlanFormData({ ...planFormData, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Linked Product (Primary Line) *</label>
                <select
                  className="form-select"
                  required
                  value={planFormData.productId}
                  onChange={(e) => setPlanFormData({ ...planFormData, productId: e.target.value })}
                >
                  <option value="">Select a product...</option>
                  {products.map((prod) => (
                    <option key={prod.id} value={prod.id}>
                      {prod.name} ({prod.type} · Base {formatMoney(prod.salesPriceMinor)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Billing Interval *</label>
                  <select
                    className="form-select"
                    value={planFormData.interval}
                    onChange={(e) => setPlanFormData({ ...planFormData, interval: e.target.value as any })}
                  >
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Plan Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    className="form-input"
                    value={planFormData.price}
                    onChange={(e) => setPlanFormData({ ...planFormData, price: e.target.value })}
                  />
                  <span className="form-help">Stored as paise: {Math.round((parseFloat(planFormData.price) || 0) * 100)}</span>
                </div>
              </div>

              <div className="form-group">
                <label>Minimum Quantity *</label>
                <input
                  type="number"
                  min="1"
                  required
                  className="form-input"
                  value={planFormData.minimumQuantity}
                  onChange={(e) => setPlanFormData({ ...planFormData, minimumQuantity: parseInt(e.target.value, 10) || 1 })}
                />
                <span className="form-help">Primary subscription line must meet or exceed this quantity</span>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Available From (Optional)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={planFormData.availableFrom}
                    onChange={(e) => setPlanFormData({ ...planFormData, availableFrom: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Available Until (Optional)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={planFormData.availableUntil}
                    onChange={(e) => setPlanFormData({ ...planFormData, availableUntil: e.target.value })}
                  />
                </div>
              </div>
              <span className="form-help" style={{ marginTop: '-8px' }}>
                Availability dates restrict when customers can subscribe, distinct from ongoing subscription expiration.
              </span>

              <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)', marginTop: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--dark)', display: 'block', marginBottom: '8px' }}>
                  Subscription Lifecycle Enforcement
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={planFormData.autoClose}
                      onChange={(e) => setPlanFormData({ ...planFormData, autoClose: e.target.checked })}
                    />
                    <span>Auto-close on expiration</span>
                  </label>
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={planFormData.allowEarlyClose}
                      onChange={(e) => setPlanFormData({ ...planFormData, allowEarlyClose: e.target.checked })}
                    />
                    <span>Allow early termination</span>
                  </label>
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={planFormData.allowPause}
                      onChange={(e) => setPlanFormData({ ...planFormData, allowPause: e.target.checked })}
                    />
                    <span>Allow pausing</span>
                  </label>
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      checked={planFormData.allowRenew}
                      onChange={(e) => setPlanFormData({ ...planFormData, allowRenew: e.target.checked })}
                    />
                    <span>Allow renewal</span>
                  </label>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '10px' }}>
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={planFormData.isActive}
                    onChange={(e) => setPlanFormData({ ...planFormData, isActive: e.target.checked })}
                  />
                  <span>Plan is active and selectable in subscriptions</span>
                </label>
              </div>

              <div className="catalog-modal-actions">
                <button type="button" className="catalog-btn catalog-btn-secondary" onClick={() => setPlanModalMode(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="catalog-btn catalog-btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : planModalMode === 'create' ? 'Create Plan' : 'Update Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT TAX RULE                                         */}
      {/* --------------------------------------------------------------------- */}
      {taxModalMode && (
        <div className="catalog-modal-backdrop" onClick={() => setTaxModalMode(null)}>
          <div className="catalog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>{taxModalMode === 'create' ? 'Create Tax Rule' : `Edit Tax Rule: ${editingTax?.name}`}</h2>
              <button type="button" className="catalog-close-btn" onClick={() => setTaxModalMode(null)}>×</button>
            </div>
            <form onSubmit={handleTaxSubmit} className="catalog-form">
              {formError && <div className="alert-error">{formError}</div>}

              <div className="form-group">
                <label>Tax Rule Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. GST 18%, Standard VAT 5%, Exempt 0%"
                  className="form-input"
                  value={taxFormData.name}
                  onChange={(e) => setTaxFormData({ ...taxFormData, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Tax Rate (%) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  placeholder="e.g. 18 or 5.5"
                  className="form-input"
                  value={taxFormData.ratePercent}
                  onChange={(e) => setTaxFormData({ ...taxFormData, ratePercent: e.target.value })}
                />
                <span className="form-help">
                  Persisted as integer basis points: <strong>{Math.round((parseFloat(taxFormData.ratePercent) || 0) * 100)} bps</strong> (1% = 100 bps)
                </span>
              </div>

              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={taxFormData.isActive}
                    onChange={(e) => setTaxFormData({ ...taxFormData, isActive: e.target.checked })}
                  />
                  <span>Tax rule is active and selectable in subscriptions/quotes</span>
                </label>
              </div>

              <div className="catalog-modal-actions">
                <button type="button" className="catalog-btn catalog-btn-secondary" onClick={() => setTaxModalMode(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="catalog-btn catalog-btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : taxModalMode === 'create' ? 'Create Tax Rule' : 'Update Tax Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT DISCOUNT RULE (Step 5)                           */}
      {/* --------------------------------------------------------------------- */}
      {discountModalMode && (
        <div className="catalog-modal-backdrop" onClick={() => setDiscountModalMode(null)}>
          <div className="catalog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <h2>{discountModalMode === 'create' ? 'Create Discount Rule' : `Edit Discount: ${editingDiscount?.name}`}</h2>
              <button type="button" className="catalog-close-btn" onClick={() => setDiscountModalMode(null)}>×</button>
            </div>
            <form onSubmit={handleDiscountSubmit} className="catalog-form">
              {formError && <div className="alert-error">{formError}</div>}

              <div className="form-group">
                <label>Discount Rule Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Early Adopter 10% Off, Launch ₹500 Voucher"
                  className="form-input"
                  value={discountFormData.name}
                  onChange={(e) => setDiscountFormData({ ...discountFormData, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Discount Kind *</label>
                  <select
                    className="form-select"
                    value={discountFormData.kind}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, kind: e.target.value as any })}
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED">Fixed Amount (₹)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    {discountFormData.kind === 'PERCENTAGE' ? 'Discount Rate (%) *' : 'Discount Amount (₹) *'}
                  </label>
                  <input
                    type="number"
                    step={discountFormData.kind === 'PERCENTAGE' ? '0.01' : '0.01'}
                    min="0"
                    max={discountFormData.kind === 'PERCENTAGE' ? '100' : undefined}
                    required
                    className="form-input"
                    value={discountFormData.value}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, value: e.target.value })}
                  />
                  <span className="form-help">
                    {discountFormData.kind === 'PERCENTAGE'
                      ? `Stored as basis points: ${Math.round((parseFloat(discountFormData.value) || 0) * 100)} bps`
                      : `Stored as paise: ${Math.round((parseFloat(discountFormData.value) || 0) * 100)} paise`}
                  </span>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Scope *</label>
                  <select
                    className="form-select"
                    value={discountFormData.scope}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, scope: e.target.value as any })}
                  >
                    <option value="SUBSCRIPTION">Whole Subscription</option>
                    <option value="PRODUCT">Specific Product</option>
                  </select>
                </div>

                {discountFormData.scope === 'PRODUCT' ? (
                  <div className="form-group">
                    <label>Target Product *</label>
                    <select
                      className="form-select"
                      required
                      value={discountFormData.productId}
                      onChange={(e) => setDiscountFormData({ ...discountFormData, productId: e.target.value })}
                    >
                      <option value="">Select a product...</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({formatMoney(p.salesPriceMinor)})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="form-group" style={{ justifyContent: 'center' }}>
                    <span className="form-help" style={{ marginTop: '22px' }}>
                      Applies to overall invoice subtotal across all eligible subscription lines.
                    </span>
                  </div>
                )}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Minimum Purchase (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    value={discountFormData.minimumPurchase}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, minimumPurchase: e.target.value })}
                  />
                  <span className="form-help">0 = No minimum purchase threshold</span>
                </div>

                <div className="form-group">
                  <label>Minimum Quantity</label>
                  <input
                    type="number"
                    min="1"
                    className="form-input"
                    value={discountFormData.minimumQuantity}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, minimumQuantity: parseInt(e.target.value, 10) || 1 })}
                  />
                  <span className="form-help">Minimum quantity required to qualify</span>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Starts At *</label>
                  <input
                    type="date"
                    required
                    className="form-input"
                    value={discountFormData.startsAt}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, startsAt: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Ends At (Optional)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={discountFormData.endsAt}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, endsAt: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Usage Limit (Optional)</label>
                <input
                  type="number"
                  min="1"
                  placeholder="Leave empty for unlimited redemptions"
                  className="form-input"
                  value={discountFormData.usageLimit}
                  onChange={(e) => setDiscountFormData({ ...discountFormData, usageLimit: e.target.value })}
                />
                <span className="form-help">Total number of times this rule can be redeemed across all customers</span>
              </div>

              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={discountFormData.isActive}
                    onChange={(e) => setDiscountFormData({ ...discountFormData, isActive: e.target.checked })}
                  />
                  <span>Discount rule is active and eligible for invoice evaluation</span>
                </label>
              </div>

              <div className="catalog-modal-actions">
                <button type="button" className="catalog-btn catalog-btn-secondary" onClick={() => setDiscountModalMode(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="catalog-btn catalog-btn-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : discountModalMode === 'create' ? 'Create Discount Rule' : 'Update Discount Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
