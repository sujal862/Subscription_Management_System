import { useState, useEffect, useCallback } from 'react';
import { api, errorMessage } from '../../lib/api';
import { formatMoney } from '../../../../shared/money';
import type { Page } from '../../../../shared/contracts';
import './catalog.css';

export interface Product {
  id: string;
  name: string;
  type: string;
  salesPriceMinor: number;
  costPriceMinor: number;
  notes: string | null;
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

const initialFormData: ProductFormData = {
  name: '',
  type: 'SOFTWARE',
  salesPrice: '',
  costPrice: '0',
  notes: '',
  isActive: true,
};

export function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (search.trim()) params.set('search', search.trim());
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter === 'active') params.set('isActive', 'true');
      if (statusFilter === 'inactive') params.set('isActive', 'false');

      const res = await api<Page<Product>>(`/catalog/products?${params.toString()}`);
      setProducts(res.items);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, typeFilter, statusFilter]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormData(initialFormData);
    setFormError(null);
    setModalMode('create');
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      type: product.type,
      salesPrice: (product.salesPriceMinor / 100).toFixed(2),
      costPrice: (product.costPriceMinor / 100).toFixed(2),
      notes: product.notes || '',
      isActive: product.isActive,
    });
    setFormError(null);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingProduct(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    const trimmedName = formData.name.trim();
    if (!trimmedName) {
      setFormError('Product name is required.');
      return;
    }

    const salesNum = parseFloat(formData.salesPrice);
    if (isNaN(salesNum) || salesNum < 0) {
      setFormError('Sales price must be a valid non-negative number.');
      return;
    }

    const costNum = parseFloat(formData.costPrice || '0');
    if (isNaN(costNum) || costNum < 0) {
      setFormError('Cost price must be a valid non-negative number.');
      return;
    }

    const salesPriceMinor = Math.round(salesNum * 100);
    const costPriceMinor = Math.round(costNum * 100);

    if (!Number.isInteger(salesPriceMinor) || salesPriceMinor < 0) {
      setFormError('Sales price must resolve to a valid non-negative integer paise amount.');
      return;
    }

    if (!Number.isInteger(costPriceMinor) || costPriceMinor < 0) {
      setFormError('Cost price must resolve to a valid non-negative integer paise amount.');
      return;
    }

    setSubmitting(true);
    try {
      if (modalMode === 'create') {
        await api<Product>('/catalog/products', {
          method: 'POST',
          body: JSON.stringify({
            name: trimmedName,
            type: formData.type.trim() || 'SOFTWARE',
            salesPriceMinor,
            costPriceMinor,
            notes: formData.notes.trim() || null,
            isActive: formData.isActive,
          }),
        });
        setSuccessMessage(`Product "${trimmedName}" created successfully.`);
      } else if (modalMode === 'edit' && editingProduct) {
        await api<Product>(`/catalog/products/${editingProduct.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: trimmedName,
            type: formData.type.trim() || 'SOFTWARE',
            salesPriceMinor,
            costPriceMinor,
            notes: formData.notes.trim() || null,
            isActive: formData.isActive,
          }),
        });
        setSuccessMessage(`Product "${trimmedName}" updated successfully.`);
      }

      closeModal();
      loadProducts();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="catalog-container">
      {/* Header */}
      <div className="catalog-header">
        <div>
          <span className="eyebrow">CATALOG & BUSINESS CONFIGURATION</span>
          <h1>Product Catalog</h1>
          <p className="muted">
            Manage your subscription products, billing prices, cost baselines, and catalog metadata.
          </p>
        </div>
        <div className="catalog-header-actions">
          <button
            type="button"
            className="catalog-btn catalog-btn-primary"
            onClick={openCreateModal}
          >
            + Add Product
          </button>
        </div>
      </div>

      {/* Feature Phase Tabs */}
      <div className="catalog-tabs">
        <button type="button" className="catalog-tab active">
          Products
          <span className="catalog-tab-badge">Step 1</span>
        </button>
        <button type="button" className="catalog-tab disabled" title="Available in Step 2">
          Variants & Plans
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

      {/* Filter Toolbar */}
      <div className="catalog-toolbar">
        <div className="catalog-filters">
          <input
            type="search"
            placeholder="Search products by name..."
            className="catalog-search-input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            className="catalog-select"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Types</option>
            <option value="SOFTWARE">Software</option>
            <option value="SERVICE">Service</option>
            <option value="HARDWARE">Hardware</option>
          </select>
          <select
            className="catalog-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
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
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value="10">10 per page</option>
            <option value="20">20 per page</option>
            <option value="50">50 per page</option>
          </select>
        </div>
      </div>

      {/* Content states */}
      {loading ? (
        <div className="panel empty-state">
          <span className="empty-symbol">⏳</span>
          <h2>Loading catalog products...</h2>
          <p className="muted">Fetching real-time product records from the database.</p>
        </div>
      ) : error ? (
        <div className="panel alert-error">
          <div>
            <strong>Unable to load catalog:</strong> {error}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
            Note: In production, catalog access requires Staff/Admin privileges. When testing in isolation,
            database queries execute against the verified SQLite catalog database.
          </p>
          <div>
            <button
              type="button"
              className="catalog-btn catalog-btn-secondary catalog-btn-small"
              onClick={loadProducts}
            >
              Retry
            </button>
          </div>
        </div>
      ) : products.length === 0 ? (
        <div className="panel empty-state">
          <span className="empty-symbol">📦</span>
          <h2>No products found</h2>
          <p className="muted">
            {search || typeFilter || statusFilter
              ? 'No products matched your search or filters. Try adjusting your query.'
              : 'There are no products in the catalog yet. Create your first product to begin offering subscriptions.'}
          </p>
          <div style={{ marginTop: '20px' }}>
            {search || typeFilter || statusFilter ? (
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('');
                  setStatusFilter('');
                  setPage(1);
                }}
              >
                Clear Filters
              </button>
            ) : (
              <button
                type="button"
                className="catalog-btn catalog-btn-primary"
                onClick={openCreateModal}
              >
                + Create First Product
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="catalog-table-wrapper">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Sales Price</th>
                  <th>Cost Basis</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const marginMinor = product.salesPriceMinor - product.costPriceMinor;
                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="product-name">{product.name}</div>
                        {product.notes && <div className="product-notes">{product.notes}</div>}
                      </td>
                      <td>
                        <span className="type-pill">{product.type}</span>
                      </td>
                      <td>
                        <strong>{formatMoney(product.salesPriceMinor)}</strong>
                      </td>
                      <td className="muted">
                        {formatMoney(product.costPriceMinor)}
                        {product.costPriceMinor > 0 && product.salesPriceMinor > 0 && (
                          <span style={{ fontSize: '0.75rem', display: 'block', color: marginMinor >= 0 ? 'var(--green)' : '#c00' }}>
                            Margin: {formatMoney(marginMinor)}
                          </span>
                        )}
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
                          onClick={() => openEditModal(product)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="catalog-pagination">
            <div>
              Showing page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total} total products)
            </div>
            <div className="pagination-controls">
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="catalog-btn catalog-btn-secondary catalog-btn-small"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal: Create / Edit Product */}
      {modalMode && (
        <div className="catalog-modal-backdrop" onClick={closeModal}>
          <div
            className="catalog-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="catalog-modal-header">
              <h2 id="modal-title">
                {modalMode === 'create' ? 'Create New Product' : `Edit Product: ${editingProduct?.name}`}
              </h2>
              <button
                type="button"
                className="catalog-close-btn"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="catalog-form">
              {formError && (
                <div className="alert-error">
                  {formError}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="prod-name">Product Name *</label>
                <input
                  id="prod-name"
                  type="text"
                  required
                  placeholder="e.g. Enterprise Cloud Server"
                  className="form-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="prod-type">Product Type</label>
                <select
                  id="prod-type"
                  className="form-select"
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="SOFTWARE">Software</option>
                  <option value="SERVICE">Service</option>
                  <option value="HARDWARE">Hardware</option>
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="prod-sales-price">Sales Price (₹) *</label>
                  <input
                    id="prod-sales-price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    className="form-input"
                    value={formData.salesPrice}
                    onChange={(e) => setFormData({ ...formData, salesPrice: e.target.value })}
                  />
                  <span className="form-help">
                    Stored in paise: {Math.round((parseFloat(formData.salesPrice) || 0) * 100)} paise
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="prod-cost-price">Cost Price (₹)</label>
                  <input
                    id="prod-cost-price"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="form-input"
                    value={formData.costPrice}
                    onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                  />
                  <span className="form-help">
                    Internal cost basis: {Math.round((parseFloat(formData.costPrice) || 0) * 100)} paise
                  </span>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="prod-notes">Internal Notes</label>
                <textarea
                  id="prod-notes"
                  rows={3}
                  placeholder="Additional specifications or catalog reference notes..."
                  className="form-textarea"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  />
                  <span>Product is active and available in catalog</span>
                </label>
              </div>

              <div className="catalog-modal-actions">
                <button
                  type="button"
                  className="catalog-btn catalog-btn-secondary"
                  onClick={closeModal}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="catalog-btn catalog-btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : modalMode === 'create' ? 'Create Product' : 'Update Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
