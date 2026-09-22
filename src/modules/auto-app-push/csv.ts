/**
 * The delivery file, exactly as the Rails batch expects it.
 *
 * Source of truth: lib/push_test/common.rb#create_auto_app_push_edition —
 *   CSV.open(path, "w", quote_char: '"', force_quotes: true) do |file|
 *     file << [deliv_id, title, "", link_type]
 *     file << [item]
 *     @login_ids.each { |login_id| file << [login_id] }
 *   end
 * force_quotes wraps every field in double quotes, a quote inside a value is
 * doubled, rows end with "\n". For link_type "01" the show id is reduced to
 * "<kogyo_code>-<kogyo_sub_code>".
 *
 * Pure: returns the path and the bytes; service.ts does the writing.
 */
import { formatTokyoDate, formatTokyoDateTime } from './time.js'
import { SHOW_ID, type ValidEdition } from './validate.js'

export interface DeliveryFile {
  /** Relative to PUSH_FILE_DIR: <YYYYMMDD>/app_push/<YYYYMMDDHHMMSS>_<deliv_id>_app_push.csv */
  relativePath: string
  content: string
}

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`
const row = (fields: string[]): string => `${fields.map(quote).join(',')}\n`

/** `9041480001-P0030001P021001` -> `904148-0001`; anything else unchanged. */
export function reduceShowId(item: string): string {
  const m = SHOW_ID.exec(item)
  return m ? `${m[1]}-${m[2]}` : item
}

export function buildDeliveryFile(edition: ValidEdition, loginIds: string[]): DeliveryFile {
  const day = formatTokyoDate(edition.publishAt)
  const stamp = formatTokyoDateTime(edition.publishAt)
  const item = edition.linkType === '01' ? reduceShowId(edition.linkItem) : edition.linkItem

  const content = row([edition.delivId, edition.title, '', edition.linkType]) + row([item]) + loginIds.map((id) => row([id])).join('')

  return {
    relativePath: `${day}/app_push/${stamp}_${edition.delivId}_app_push.csv`,
    content,
  }
}
