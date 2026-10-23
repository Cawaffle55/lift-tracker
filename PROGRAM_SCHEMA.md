# Lift Tracker program format (`lift-tracker/program@1`)

A **program** has weeks → each week has days → each day has exercises.
Import it from **Programs → Import program file** (`.json` or `.csv`) or **Paste text**.

## JSON

```json
{
  "schema": "lift-tracker/program@1",
  "name": "My PPL",
  "author": "optional",
  "description": "optional",
  "source": "optional; URLs separated by \"; \" are shown as links on the program screen",
  "schedule": ["Legs 1", "Push 1", "Pull 1", "Rest"],
  "weeks": [
    {
      "name": "Week 1",
      "notes": "optional week notes",
      "days": [
        {
          "name": "Push",
          "notes": "optional day notes",
          "exercises": [
            {
              "name": "Barbell Bench Press",
              "warmupSets": 2,
              "workingSets": 3,
              "reps": "6-8",
              "rpe": "8",
              "rir": "",
              "technique": "Drop set on last set",
              "load": "",
              "rest": "2-3 min",
              "notes": "Shoulder blades pinned.",
              "substitutions": ["Dumbbell Bench Press", "Machine Chest Press"],
              "superset": ""
            }
          ]
        }
      ]
    }
  ]
}
```

### Exercise fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Exercise name. History/PRs/"last time" are matched by name (case-insensitive). |
| `warmupSets` | int | no (0) | Warm-up sets, shown as **W** rows. |
| `workingSets` | int | no (3) | Working sets. |
| `reps` | string | no | Target reps: `"8"`, `"8-10"`, `"AMRAP"`, `"12-15 (last set to failure)"`. The first number pre-fills the reps placeholder. |
| `rpe` | string | no | Target RPE, e.g. `"8"`, `"8-9"`, `"8 / 9"` (early / last set). |
| `rir` | string | no | Target reps in reserve, e.g. `"1-2"`. |
| `technique` | string | no | Intensity technique (drop set, myo-reps, rest-pause, lengthened partials…). |
| `load` | string | no | Optional load prescription, e.g. `"75% 1RM"`. |
| `rest` | string or number | no | Rest, e.g. `"2-3 min"`, `"90s"`, `"1:30"`, `120`. Parsed into `restSeconds` (a range uses the **upper** bound; a bare number ≤ 10 is minutes, otherwise seconds). Drives the auto rest timer (warm-up sets use `restWarmupSeconds` or the warm-up rest setting). Falls back to Settings → Default rest time (1:30). Note: with Settings → *Use default rest for all exercises* on (the default), the default overrides program rest values. |
| `restSeconds` | int | no | Explicit rest in seconds (wins over `rest`). |
| `restWarmupSeconds` | int | no | Rest after warm-up sets, in seconds (aliases `restWarmup`, `warmup_rest`; same parsing as `rest`). If missing, Settings → *Warm-up set rest* (1:00) is used, capped at the working rest. |
| `notes` | string | no | Coaching notes/cues shown on the exercise card. |
| `libraryId` | string | no | Id of an entry in `data/exercises.json` (e.g. `"Pushups"`, `"lt-doorway-row"`). Links the exercise to its library card (ⓘ button: description, muscles, form photos). If missing, the app matches by name/alias. |
| `tracking` | `"reps"` \| `"time"` | no | `"time"` logs **seconds** per set (planks, holds); `reps` values like `"30-45 s"` imply it. Defaults to the library entry's tracking, else reps. |
| `bodyweight` | bool | no | Weight is optional: a set with no weight logs as **BW**, added weight as **BW+25**. Defaults from the library (equipment = bodyweight). |
| `substitutions` | string[] | no | Swap options (also accepts a string separated by `|`, `;` or `,`). Selectable from the exercise ⋯ menu. |
| `superset` | string | no | Group label (e.g. `"A"`). Consecutive exercises with the same label are shown with a purple bar / "Superset A" pill, and the rest timer only starts after the **last** exercise of the group. |
| `source` | string | no | Where this exercise's data came from (kept, shown in Edit JSON). |

### Program-level optional fields
| Field | Meaning |
|---|---|
| `schedule` | Weekly order of days including rest days, e.g. `["Legs 1","Push 1","Pull 1","Legs 2","Push 2","Pull 2","Rest"]`. Displayed as "Weekly order" on the Workout tab and program screen. (The "up next" sequence follows the order of `days`.) |
| `source` | Source URLs/notes, rendered as links. |
| `author`, `description` | Shown on the program screen. |

Aliases accepted on import: `sets`→`workingSets`, `warmups`/`warmup_sets`→`warmupSets`, `subs`/`alternatives`→`substitutions`, `exercise`→`name`, `rest_seconds`→`restSeconds`, `intensity`→`rpe`.

### Shorthand: same days every week

```json
{ "name": "Simple PPL", "weeks": 4, "days": [ { "name": "Push", "exercises": [ ... ] } ] }
```
`weeks` as a number + top-level `days` repeats the day template that many weeks.

A JSON array of programs is also accepted (each is imported). Full app backups (`"app": "lift-tracker"`) go through **Settings → Import backup** instead.

## CSV

One row per exercise, with a header row. Column names are matched loosely (case-insensitive, by keyword), so these all work: `Exercise`, `Working Sets`, `Warm-up Sets`, `Early Set RPE`, `Substitution Option 1`.

| Column | Maps to | Notes |
|---|---|---|
| `program` | program name | optional, read from the first data row |
| `week` | week | `1` becomes "Week 1"; blank = same as the row above |
| `day` | day name | blank = same as the row above |
| `exercise` | `name` | **required** |
| `warmup_sets` | `warmupSets` | |
| `working_sets` (or `sets`) | `workingSets` | |
| `reps` | `reps` | **`reps` or `sets` required** |
| `rpe` | `rpe` | several RPE columns are joined: `8 / 9` |
| `rir` | `rir` | |
| `technique` | `technique` | |
| `load` | `load` | |
| `rest` | `rest` | e.g. `2-3 min`, `90s` |
| `notes` | `notes` | |
| `substitutions` | `substitutions` | separate with `|`; several "Substitution" columns are combined |

Example: [`sample/example-ppl.csv`](sample/example-ppl.csv). Quote cells containing commas (`"cue, cue"`). Tab-separated files work too.

## Paste text (best effort)

See README → "Paste importer". It accepts the CSV layout above pasted from a spreadsheet (tabs), Markdown/pipe tables, or free-text lines such as `Bench Press 3x8-10 RPE 8 2-3 min`, with `Week N` / day-name headings on their own lines. Always review the preview before saving; you can fix anything afterwards with **Programs → (program) → Edit JSON**.

## Share links
Program → 📤 Share builds `…/index.html#/import/link/<code>`. `<code>` is `z` + base64url(deflate-raw(program JSON)), or `j` + base64url(JSON) when the browser has no CompressionStream. Opening the link decodes it on the device and shows the normal import preview; nothing is uploaded.

## Workout history CSV (import / export)
Settings → *Import Strong / Hevy CSV…* reads:
- **Hevy** exports (`title, start_time, end_time, exercise_title, set_type, weight_lbs|weight_kg, reps, duration_seconds, rpe, …`).
- **Strong** exports (`Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Seconds, Notes, Workout Notes, RPE`; comma or semicolon). `Set Order` `W`/`D`/`F` = warm-up/drop/failure. Rest Timer rows are skipped. Units aren't in Strong's file unless it says `Weight (kg)`, so the app asks.
- Lift Tracker's own export: `start, end, duration_sec, workout, program, exercise, set, set_type, weight, unit, reps, seconds, rpe, tracking, bodyweight, exercise_notes, workout_notes`. `set_type` is one of `normal`, `warmup`, `failure`, `dropset`. Timed sets put the hold in `seconds`.
