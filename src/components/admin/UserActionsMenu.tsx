'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import type { Profile } from '@/types'

export default function UserActionsMenu({ user, currentAdminId }: { user: Profile; currentAdminId: string }) {
  const isSelf = user.id === currentAdminId
  const router = useRouter()
  const [showDeactivateModal, setShowDeactivateModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function toggleStatus() {
    setLoading(true)
    setActionError(null)
    const newStatus = user.status === 'active' ? 'inactive' : 'active'
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setActionError(data.error || 'Failed to update user status.')
    } else {
      setShowDeactivateModal(false)
      router.refresh()
    }
    setLoading(false)
  }

  async function deleteUser() {
    setLoading(true)
    setActionError(null)
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setActionError(data.error || 'Failed to delete user.')
    } else {
      setShowDeleteModal(false)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <>
      {actionError && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 text-xs text-red-700 px-4 py-3 shadow-lg max-w-xs">
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-3 text-red-400 hover:text-red-700">✕</button>
        </div>
      )}
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-[#e5e3df] shadow-lg z-50">
              <button
                onClick={() => { setMenuOpen(false); router.push(`/admin/users/${user.id}`) }}
                className="flex items-center w-full px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Edit details
              </button>
              <button
                onClick={() => { setMenuOpen(false); setShowDeactivateModal(true) }}
                disabled={isSelf}
                className="flex items-center w-full px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-white"
                title={isSelf ? 'You cannot deactivate your own account' : undefined}
              >
                {user.status === 'active' ? 'Deactivate' : 'Reactivate'}
              </button>
              <button
                onClick={() => { setMenuOpen(false); setShowDeleteModal(true) }}
                disabled={isSelf}
                className="flex items-center w-full px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-white"
                title={isSelf ? 'You cannot delete your own account' : undefined}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      <Modal
        open={showDeactivateModal}
        onClose={() => setShowDeactivateModal(false)}
        onConfirm={toggleStatus}
        title={user.status === 'active' ? 'Deactivate user?' : 'Reactivate user?'}
        description={
          user.status === 'active'
            ? `${user.email} will be logged out immediately and will not be able to sign in.`
            : `${user.email} will regain access to the platform.`
        }
        confirmLabel={user.status === 'active' ? 'Deactivate' : 'Reactivate'}
        confirmVariant={user.status === 'active' ? 'danger' : 'primary'}
        loading={loading}
      />

      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={deleteUser}
        title="Delete user?"
        description={`This will permanently remove ${user.email}. Their research history will be kept for records. This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={loading}
      />
    </>
  )
}
