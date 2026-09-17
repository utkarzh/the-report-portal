'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import Button from '@/components/ui/Button'
import UploadReceiptModal from './UploadReceiptModal'

interface Props {
  projectId: string
  settlementCurrency: string
  defaultExchangeRate: number
}

// Just the "Upload receipt" trigger + its modal — kept separate from the
// "Needs your attention" section (NeedsAttentionSection) so this can sit
// inline in a button row without a full-width block breaking the layout.
export default function FieldProjectActions({ projectId, settlementCurrency, defaultExchangeRate }: Props) {
  const router = useRouter()
  const [uploadOpen, setUploadOpen] = useState(false)

  return (
    <>
      <Button size="sm" onClick={() => setUploadOpen(true)}>
        <Upload size={13} className="mr-1.5 inline" /> Upload receipt
      </Button>
      <UploadReceiptModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onLogged={() => router.refresh()}
        projectId={projectId}
        settlementCurrency={settlementCurrency}
        defaultExchangeRate={defaultExchangeRate}
      />
    </>
  )
}
