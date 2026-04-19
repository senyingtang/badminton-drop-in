'use client'

import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './LogoDropzone.module.css'

const BUCKET = 'pickup-group-logos'
const MAX_BYTES = 2 * 1024 * 1024
const ACCEPT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif'

type Props = {
  userId: string
  logoUrl: string | null
  onUrlChange: (url: string | null) => void
  disabled?: boolean
}

function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'jpg'
}

function extractStoragePath(logoUrl: string | null): string | null {
  if (!logoUrl) return null
  const needle = `/object/public/${BUCKET}/`
  const i = logoUrl.indexOf(needle)
  if (i === -1) return null
  return decodeURIComponent(logoUrl.slice(i + needle.length))
}

export default function LogoDropzone({ userId, logoUrl, onUrlChange, disabled }: Props) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  const uploadFile = useCallback(
    async (file: File) => {
      setLocalErr(null)
      if (!file.size) {
        setLocalErr('檔案是空的')
        return
      }
      if (file.size > MAX_BYTES) {
        setLocalErr('檔案超過 2MB，請壓縮或改選較小的圖片')
        return
      }
      if (!ACCEPT_MIME.has(file.type)) {
        setLocalErr('僅支援 JPEG、PNG、WebP、GIF')
        return
      }

      setUploading(true)
      try {
        const ext = mimeToExt(file.type)
        const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
        const path = `${userId}/${name}`

        const oldPath = extractStoragePath(logoUrl)

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        })

        if (upErr) {
          const msg = upErr.message || ''
          if (/bucket|not found|404/i.test(msg)) {
            setLocalErr('尚未建立儲存空間：請在 Supabase 執行 docs/040_pickup_group_logo_storage.sql')
          } else {
            setLocalErr(msg)
          }
          return
        }

        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
        if (oldPath) {
          void supabase.storage.from(BUCKET).remove([oldPath])
        }
        onUrlChange(pub.publicUrl)
      } catch (e) {
        setLocalErr(e instanceof Error ? e.message : '上傳失敗')
      } finally {
        setUploading(false)
      }
    },
    [logoUrl, onUrlChange, supabase, userId]
  )

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) void uploadFile(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (disabled || uploading) return
    const f = e.dataTransfer.files?.[0]
    if (f) void uploadFile(f)
  }

  const clearLogo = () => {
    const oldPath = extractStoragePath(logoUrl)
    if (oldPath) {
      void supabase.storage.from(BUCKET).remove([oldPath])
    }
    onUrlChange(null)
    setLocalErr(null)
  }

  const busy = disabled || uploading

  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.drop} ${dragOver ? styles.dropActive : ''} ${busy ? styles.dropDisabled : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          if (!busy) setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragOver(false)
        }}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (busy) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="上傳臨打團 Logo：點選或拖放圖片"
      >
        <input
          ref={inputRef}
          type="file"
          className={styles.hiddenInput}
          accept={ACCEPT_ATTR}
          onChange={onPick}
          disabled={busy}
          aria-hidden
        />
        <p className={styles.dropTitle}>{uploading ? '上傳中…' : '拖放圖片到此，或點選選檔'}</p>
        <p className={styles.dropHint}>
          行動裝置點選後可從<strong>相簿／圖庫</strong>選圖，或依系統選項使用相機拍照。JPEG／PNG／WebP／GIF，單檔最多 2MB。
        </p>
      </div>

      {localErr && <p className={styles.err}>{localErr}</p>}

      {logoUrl && (
        <div className={styles.previewRow}>
          <div className={styles.previewBox}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="臨打團 Logo 預覽" className={styles.previewImg} />
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              更換圖片
            </button>
            <button type="button" className={styles.linkBtn} disabled={busy} onClick={clearLogo}>
              移除 Logo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
