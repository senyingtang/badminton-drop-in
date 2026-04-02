export function exportToCSV(data: any[], filename: string) {
  if (!data || data.length === 0) return

  // Get headers from first object
  const headers = Object.keys(data[0])
  const csvRows = []

  // Add headers, quoting them to be safe
  csvRows.push(headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(','))

  // Add rows
  for (const row of data) {
    const values = headers.map((h) => {
      let val = row[h]
      // Handle null/undefined
      if (val === null || val === undefined) {
        val = ''
      } else if (typeof val === 'object') {
        // Simple stringification of objects/arrays
        val = JSON.stringify(val)
      }
      return `"${String(val).replace(/"/g, '""')}"`
    })
    csvRows.push(values.join(','))
  }

  // Add BOM for Excel UTF-8 support
  const csvContent = '\uFEFF' + csvRows.join('\n')
  
  // Create blob and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.csv`)
  link.style.visibility = 'hidden'
  
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
