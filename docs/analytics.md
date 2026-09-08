# PostHog events

The app sends manual events through `posthog.capture(event, properties)`.
It uses the existing browser setup in `index.html`.
Automatic click and input capture is off. PostHog still handles page views and page leaves.
See the [PostHog capture documentation](https://posthog.com/docs/libraries/js/usage#custom-event-capture).

## Common properties

Every event has `layout`: `mobile` or `desktop`. This follows the app's layout at page load.
Events during or after a run also have these properties:

| Property | Meaning |
| --- | --- |
| `run_id` | Identifier for one tutorial or game. Each new run gets a new value. |
| `game_phase` | `tutorial` or `playing`. |
| `level` | `easy`, `medium`, `hard`, or `insane`. Null for the tutorial. |
| `word` | The English word selected by the app. |
| `total_languages` | The score target. A game includes the English answer given at the start. |
| `time_limit_seconds` | 150 for Easy, Medium, and Hard. Null for the tutorial and Insane. |
| `start_source` | `first_visit`, `level_selection`, `level_change`, `new_word`, or `play_again`. |

Events before a run, such as a returning visitor's tutorial skip, have no run properties.
Custom events contain no email addresses, typed answers, or raw error messages.
Players stay anonymous. The app does not call `identify`.

## Event list

| Event | Trigger and extra properties |
| --- | --- |
| `tutorial_started` | The first-visit tutorial starts. |
| `tutorial_skipped` | The browser has the existing tutorial marker. `reason: returning_visitor`. This marker means the tutorial was started before. |
| `tutorial_completed` | All tutorial prompts are resolved. Includes the run summary. |
| `tutorial_abandoned` | A game replaces an unfinished tutorial. Includes the run summary. |
| `game_started` | A level starts, including replay and word changes. |
| `game_ended` | Results appear. `reason`: `completed`, `timeUp`, or `mistake`. Includes the run summary. |
| `game_abandoned` | A new game replaces an unfinished game. `reason` is the new start source. Includes the run summary. |
| `answer_submitted` | A nonempty answer passes the input guards. `round_number`, `prompt_language`, `group_size`, `attempt_number`, `is_correct`, `matched_language`, `input_source`. The matched language comes from the app's fixed list. |
| `challenge_skipped` | A skip is accepted. `round_number`, `prompt_language`, `group_size`, `wrong_attempts`, `input_source`: `keyboard` or `skip_button`. Insane ends with `mistake` after a skip. |
| `hint_shown` | A hint appears. `hint_type`: `answer_entry`, `skip`, or `geography`. Includes `round_number`. |
| `menu_opened` | The mobile menu opens. |
| `about_viewed` | The About page opens. |
| `result_share_requested` | A share control is used. `channel`: `result_button`, `whatsapp`, `x`, `bluesky`, `instagram`, or `tiktok`. External links also have `method: external_link`. Includes the saved run summary. |
| `result_share_completed` | The native share call succeeds. `method: native`. This does not confirm a social post. |
| `result_share_cancelled` | The native share call returns `AbortError`. The existing download fallback still runs. |
| `result_share_failed` | Image generation or native sharing fails. `reason`: `image_generation` or `native_share`. |
| `result_card_download_started` | The browser download is triggered. This does not confirm that a file was saved. |
| `newsletter_validation_failed` | An email is empty or invalid. `reason`: `empty_email` or `invalid_email`. |
| `newsletter_subscription_submitted` | A valid form starts a request to Formspree. |
| `newsletter_subscription_succeeded` | Formspree accepts the request. This does not confirm email verification. |
| `newsletter_subscription_failed` | The request fails. `reason`: `http_error` or `network_error`. HTTP means Hypertext Transfer Protocol. HTTP failures include `status_code`. |

## Run summaries

A run emits its end or abandonment event once. The summary contains `reason`,
`elapsed_ms`, `rounds_presented`, `attempts`, `correct_languages`, `missed_languages`,
and `remaining_languages`. Share events reuse that summary, so waiting on the results
screen does not increase the recorded game time.

Scores follow the current game logic. English starts with one correct point.
One prompt can resolve several languages with the same spelling.
`attempts` excludes skips. `elapsed_ms` uses the game clock and its existing About pause behavior.

Abandonment events cover a new game replacing an active run. Closing a tab does not emit
a custom abandonment event. Use PostHog's page-leave event and runs without an end event
to study those exits. Browser or network failures can prevent event delivery.

## Checks

Run these checks from the repository root:

```sh
node tests/analytics.mjs
node tests/mobile-textarea.mjs
```

The analytics checks run both layouts with controlled timers and a document stub.
They replace PostHog, Formspree, and native sharing. They send no real events or emails.
They also check missing or failed PostHog capture, duplicate result calls, and private input exclusion.
