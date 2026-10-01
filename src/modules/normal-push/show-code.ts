/**
 * Reads a show code the way ecs-api's `Epica::ViewV2::SHOW_ID_FORMAT` does
 * (app/models/epica/view_v2.rb:31) — the regex `create_topics_edition` matches every `code`
 * against (docs/create_topics_edition_flow.md, step 3):
 *
 *   9014500001-P0030010P021001
 *   └kogyo┘└tour┘ └─sub──┘└koen┘
 *
 * - 6 digits of kogyo_code, then 4 of tour_code;
 * - optionally `-` followed by one or more `P003<4 digits>` (kogyo_sub_code) / `P021<3 digits>`
 *   (koen_code) parts, in any order. The Ruby regex reuses one group name for each kind, and
 *   reading it gives the last one matched, so a later part of the same kind wins;
 * - optionally a `?…` query, which is ignored.
 *
 * A JS regex cannot repeat a group name, so the outer shape is matched first and the parts are
 * read with a second, global regex. Anything in front of the code (a pasted `[公演]`) fails, as in
 * ecs-api, where `\A` anchors the match.
 */

export interface ShowCode {
  kogyoCode: string
  tourCode: string
  /** Null when there is no `P003…` part. */
  kogyoSubCode: string | null
  /** Null when there is no `P021…` part — the code then needs the e+ search API to expand. */
  koenCode: string | null
}

const SHAPE = /^(\d{6})(\d{4})(?:-((?:P003\d{4}|P021\d{3})+))?(?:\?.*)?$/
const PART = /P003(\d{4})|P021(\d{3})/g

export function parseShowCode(code: string): ShowCode | null {
  const m = SHAPE.exec(code)
  if (!m) return null

  let kogyoSubCode: string | null = null
  let koenCode: string | null = null
  for (const part of (m[3] ?? '').matchAll(PART)) {
    if (part[1] !== undefined) kogyoSubCode = part[1]
    if (part[2] !== undefined) koenCode = part[2]
  }

  return { kogyoCode: m[1], tourCode: m[2], kogyoSubCode, koenCode }
}
