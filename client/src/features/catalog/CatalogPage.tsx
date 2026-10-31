import { useState, useEffect, useCallback } from 'react';
import { api, errorMessage } from '../../lib/api';
import { formatMoney } from '../../../../shared/money';
import type { Page } from '../../../../shared/contracts';
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
  isActive: true,
};

export function CatalogPage() {
  const [activeTab, setActiveTab] = useState<'products' | 'plans'>('products');

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

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Pricing Rule Preview modal / state
  const [showPricingCalc, setShowPricingCalc] = useState(false);
  const [calcPlanId, setCalcPlanId] = useState('');
  const [calcAddonProductId, setCalcAddonProductId] = useState('');
  const [calcResult, setCalcResult] = useState<any>(null);

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

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (activeTab === 'plans') {
      loadPlans();
    }
  }, [activeTab, loadPlans]);

  // ---------------------------------------------------------------------------
  // Product Modal Handlers
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

    const costNum = parseFloat(productFormData.costPrice || '0');
    if (isNaN(costNum) || costNum < 0) {
      setFormError('Cost price must be a valid non-negative number.');
      return;
    }

    const salesPriceMinor = Math.round(salesNum * 100);
    const costPriceMinor = Math.round(costNum * 100);

    setSubmitting(true);
    try {
      if (productModalMode === 'create') {
        await api<Product>('/catalog/products', {
          method: 'POST',
          body: JSON.stringify({
            name: trimmedName,
            type: productFormData.type.trim() || 'SOFTWARE',
            salesPriceMinor,
            costPriceMinor,
            notes: productFormData.notes.trim() || null,
            isActive: productFormData.isActive,
          }),
        });
        setSuccessMessage(`Product "${trimmedName}" created successfully.`);
      } else if (productModalMode === 'edit' && editingProduct) {
        await api<Product>(`/catalog/products/${editingProduct.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: trimmedName,
            type: productFormData.type.trim() || 'SOFTWARE',
            salesPriceMinor,
            costPriceMinor,
            notes: productFormData.notes.trim() || null,
            isActive: productFormData.isActive,
          }),
        });
        setSuccessMessage(`Product "${trimmedName}" updated successfully.`);
      }

      setProductModalMode(null);
      loadProducts();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Variant Modal Handlers
  // ---------------------------------------------------------------------------

  const openAddVariant = (product: Product) => {
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
    if (!variantTargetProduct) return;
    setFormError(null);

    const trimmedName = variantFormData.name.trim();
    if (!trimmedName) {
      setFormError('Variant name is required.');
      return;
    }

    const adjNum = parseFloat(variantFormData.priceAdjustment || '0');
    if (isNaN(adjNum)) {
      setFormError('Price adjustment must be a valid number.');
      return;
    }

    const priceAdjustmentMinor = Math.round(adjNum * 100);

    setSubmitting(true);
    try {
      if (variantModalMode === 'create') {
        await api<ProductVariant>(`/catalog/products/${variantTargetProduct.id}/variants`, {
          method: 'POST',
          body: JSON.stringify({
            name: trimmedName,
            priceAdjustmentMinor,
            isActive: variantFormData.isActive,
          }),
        });
        setSuccessMessage(`Variant "${trimmedName}" added to ${variantTargetProduct.name}.`);
      } else if (variantModalMode === 'edit' && editingVariant) {
        await api<ProductVariant>(`/catalog/products/${variantTargetProduct.id}/variants/${editingVariant.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: trimmedName,
            priceAdjustmentMinor,
            isActive: variantFormData.isActive,
          }),
        });
        setSuccessMessage(`Variant "${trimmedName}" updated.`);
      }

      setVariantModalMode(null);
      loadProducts();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Plan Modal Handlers
  // ---------------------------------------------------------------------------

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanFormData({
      ...initialPlanFormData,
      productId: products[0]?.id || '',
    });
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
      setFormError('Linked product is required.');
      return;
    }

    const priceNum = parseFloat(planFormData.price);
    if (isNaN(priceNum) || priceNum < 0) {
      setFormError('Plan price must be a valid non-negative number.');
      return;
    }

    const priceMinor = Math.round(priceNum * 100);

    if (planFormData.minimumQuantity < 1) {
      setFormError('Minimum quantity must be at least 1.');
      return;
    }

    if (planFormData.availableFrom && planFormData.availableUntil) {
      if (planFormData.availableUntil < planFormData.availableFrom) {
        setFormError('Available Until date must be on or after Available From date.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        productId: planFormData.productId,
        priceMinor,
        interval: planFormData.interval,
        minimumQuantity: planFormData.minimumQuantity,
        availableFrom: planFormData.availableFrom || null,
        availableUntil: planFormData.availableUntil || null,
        isActive: planFormData.isActive,
      };

      if (planModalMode === 'create') {
        await api<Plan>('/catalog/plans', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Plan "${trimmedName}" created successfully.`);
      } else if (planModalMode === 'edit' && editingPlan) {
        await api<Plan>(`/catalog/plans/${editingPlan.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccessMessage(`Plan "${trimmedName}" updated successfully.`);
      }

      setPlanModalMode(null);
      loadPlans();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Pricing Calculator Handler (Agreed Primary-Line Pricing Rule)
  // ---------------------------------------------------------------------------

  const runPricingCalc = async () => {
    if (!calcPlanId) return;
    const selectedPlan = plans.find(p => p.id === calcPlanId);
    if (!selectedPlan) return;

    try {
      const lines: any[] = [
        { productId: selectedPlan.productId, quantity: selectedPlan.minimumQuantity },
      ];
      if (calcAddonProductId && calcAddonProductId !== selectedPlan.productId) {
        lines.push({ productId: calcAddonProductId, quantity: 1 });
      }

      const res = await api<any>('/catalog/pricing/calculate', {
        method: 'POST',
        body: JSON.stringify({
          planId: selectedPlan.id,
          lines,
        }),
      });
      setCalcResult(res);
    } catch (err: unknown) {
      alert(`Pricing calculation failed: ${errorMessage(err)}`);
    }
  };

  const productTotalPages = Math.max(1, Math.ceil(productTotal / productPageSize));
  const planTotalPages = Math.max(1, Math.ceil(planTotal / planPageSize));

  return (
    <div className="catalog-container">
      {/* Header */}
      <div className="catalog-header">
        <div>
          <span className="eyebrow">CATALOG & BUSINESS CONFIGURATION</span>
          <h1>Product Catalog & Plans</h1>
          <p className="muted">
            Manage your subscription products, variants, recurring billing plans, and pricing rules.
          </p>
        </div>
        <div className="catalog-header-actions">
          {activeTab === 'products' ? (
            <button
              type="button"
              className="catalog-btn catalog-btn-primary"
              onClick={openCreateProduct}
            >
              + Add Product
            </button>
          ) : (
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
                onClick={openCreatePlan}
              >
                + Add Plan
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
          Recurring Plans
          <span className="catalog-tab-badge">Step 2</span>
        </button>
        <button type="button" className="catalog-tab disabled" title="Available in Step 4">
          Tax Rules
          <span className="catalog-tab-badge">Step 4</span>
        </button>
        <button type="button" className="catalog-tab disabled" title="Available in Step 5">
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

      {/* Primary-Line Pricing Calculation Preview Banner */}
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

      {/* --------------------------------------------------------------------- */}
      {/* TAB 1: PRODUCTS & VARIANTS                                            */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'products' && (
        <>
          {/* Filter Toolbar */}
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
                <option value="inactive">Inactive Only</option>
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

          {/* Product list states */}
          {productsLoading ? (
            <div className="panel empty-state">
              <span className="empty-symbol">⏳</span>
              <h2>Loading catalog products & variants...</h2>
              <p className="muted">Fetching real-time records from database.</p>
            </div>
          ) : productsError ? (
            <div className="panel alert-error">
              <div><strong>Unable to load catalog:</strong> {productsError}</div>
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
              <p className="muted">Get started by creating your first product record.</p>
              <div style={{ marginTop: '18px' }}>
                <button type="button" className="catalog-btn catalog-btn-primary" onClick={openCreateProduct}>
                  + Create First Product
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
                      <th>Cost Basis</th>
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
                          
                          {/* Variants list */}
                          <div className="variant-chips">
                            {product.variants && product.variants.length > 0 ? (
                              product.variants.map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  className={`variant-chip ${v.isActive ? '' : 'inactive'}`}
                                  title="Click to edit variant"
                                  onClick={() => openEditVariant(product, v)}
                                >
                                  <span>{v.name}</span>
                                  <span className={`variant-chip-adjustment ${v.priceAdjustmentMinor < 0 ? 'negative' : ''}`}>
                                    {v.priceAdjustmentMinor > 0 ? `+${formatMoney(v.priceAdjustmentMinor)}` : v.priceAdjustmentMinor < 0 ? formatMoney(v.priceAdjustmentMinor) : '±₹0'}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <span className="muted" style={{ fontSize: '0.75rem' }}>No variants</span>
                            )}
                            <button
                              type="button"
                              className="catalog-btn catalog-btn-secondary catalog-btn-small"
                              style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                              onClick={() => openAddVariant(product)}
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
                            ● {product.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="catalog-btn catalog-btn-secondary catalog-btn-small"
                            onClick={() => openEditProduct(product)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
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
      {/* TAB 2: RECURRING PLANS                                                */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'plans' && (
        <>
          {/* Plan Filter Toolbar */}
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
                <option value="inactive">Inactive Only</option>
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

          {/* Plans list states */}
          {plansLoading ? (
            <div className="panel empty-state">
              <span className="empty-symbol">⏳</span>
              <h2>Loading recurring plans...</h2>
              <p className="muted">Fetching plans and linked product details.</p>
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
                <button type="button" className="catalog-btn catalog-btn-primary" onClick={openCreatePlan}>
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
                          <span className={`status-pill ${plan.isActive ? 'active' : 'inactive'}`}>
                            ● {plan.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="catalog-btn catalog-btn-secondary catalog-btn-small"
                            onClick={() => openEditPlan(plan)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
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

              <div className="form-group">
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
    </div>
  );
}
