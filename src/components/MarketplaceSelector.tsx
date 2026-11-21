import { Check, Store } from 'lucide-react'
import type { Marketplace } from '../types'

interface MarketplaceSelectorProps {
  value: Marketplace
  onChange: (marketplace: Marketplace) => void
}

const marketplaces: Array<{ value: Marketplace; name: string; detail: string; monogram: string }> = [
  { value: 'amazon', name: 'Amazon', detail: 'Seller central reports', monogram: 'a' },
  { value: 'flipkart', name: 'Flipkart', detail: 'Seller hub reports', monogram: 'f' },
  { value: 'meesho', name: 'Meesho', detail: 'Supplier panel reports', monogram: 'm' },
  { value: 'generic', name: 'Other marketplace', detail: 'Standard sales report', monogram: 'o' },
]

function MarketplaceSelector({ value, onChange }: MarketplaceSelectorProps) {
  return (
    <div className="marketplace-options" role="group" aria-label="Select marketplace">
      {marketplaces.map((marketplace) => (
        <button
          aria-pressed={value === marketplace.value}
          className={`marketplace-option${value === marketplace.value ? ' selected' : ''}`}
          key={marketplace.value}
          onClick={() => onChange(marketplace.value)}
          type="button"
        >
          <span className={`marketplace-logo ${marketplace.value}`}>
            {marketplace.value === 'amazon' ? marketplace.monogram : <Store size={20} />}
          </span>
          <span className="marketplace-copy">
            <strong>{marketplace.name}</strong>
            <small>{marketplace.detail}</small>
          </span>
          <span className="marketplace-check">{value === marketplace.value && <Check size={14} />}</span>
        </button>
      ))}
    </div>
  )
}

export default MarketplaceSelector
