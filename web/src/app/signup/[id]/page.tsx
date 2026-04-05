import { redirect } from 'next/navigation'

type PageProps = { params: Promise<{ id: string }> }

/** 舊版或文件中的 `/signup/:code` 連結轉到實際公開報名頁 `/s/:code`。 */
export default async function SignupAliasPage({ params }: PageProps) {
  const { id } = await params
  redirect(`/s/${encodeURIComponent(id)}`)
}
