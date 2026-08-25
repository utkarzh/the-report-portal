'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical, Pencil, Ban, RotateCcw, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import EditUserModal from '@/components/admin/EditUserModal'
import type { Profile } from '@/types'

export default function UserActionsMenu({ user, currentAdminId }: { user: Profile; currentAdminId: string }) {
  const isSelf = user.id === currentAdminId
  const router = useRouter()
  const [showEditModal, setShowEditModal] = useState(false)
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
          className={`p-1.5 rounded-full transition-colors ${
            menuOpen ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
          }`}
        >
          <MoreVertical size={16} strokeWidth={1.75} />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="dropdown-in origin-top-right absolute right-0 top-full mt-1.5 w-48 bg-white border border-[#e5e3df] shadow-lg z-50 py-1">
              <button
                onClick={() => { setMenuOpen(false); setShowEditModal(true) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Pencil size={14} strokeWidth={1.75} className="text-gray-400 flex-shrink-0" />
                Edit details
              </button>
              <button
                onClick={() => { setMenuOpen(false); setShowDeactivateModal(true) }}
                disabled={isSelf}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-white"
                title={isSelf ? 'You cannot deactivate your own account' : undefined}
              >
                {user.status === 'active' ? (
                  <Ban size={14} strokeWidth={1.75} className={isSelf ? 'text-gray-300' : 'text-amber-500'} />
                ) : (
                  <RotateCcw size={14} strokeWidth={1.75} className={isSelf ? 'text-gray-300' : 'text-emerald-600'} />
                )}
                {user.status === 'active' ? 'Deactivate' : 'Reactivate'}
              </button>
              <div className="my-1 h-px bg-[#e5e3df]" />
              <button
                onClick={() => { setMenuOpen(false); setShowDeleteModal(true) }}
                disabled={isSelf}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed disabled:hover:bg-white"
                title={isSelf ? 'You cannot delete your own account' : undefined}
              >
                <Trash2 size={14} strokeWidth={1.75} className={isSelf ? 'text-gray-300' : 'text-red-500'} />
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      <EditUserModal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        user={user}
        isSelf={isSelf}
      />

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
