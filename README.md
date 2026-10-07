# PayFlow: Digital Payment Transactions

Payment simulation built for **Algorithm Design and Complexity**. Each user has a wallet (starts with Rs 2000) and a PayFlow ID (`name@payflow`). Payments go into a FIFO queue, can be searched (Linear Search), sorted (Bubble Sort, visualised), and every algorithm shows operation counts and complexity.

Educational only. No real money is processed.

## Run locally
```
npm install
npm start      # http://localhost:3000
```
Requires Node 22.13+ (uses the built-in `node:sqlite`).

## Deploy on Render
1. Push this folder to a GitHub repo (`node_modules` and `*.db` are git-ignored).
2. In Render choose **New > Blueprint**, select the repo. `render.yaml` sets everything up: Node 22, health check `/healthz`, and a 1 GB persistent disk at `/var/data` for the SQLite database.
3. Open the URL Render gives you.

**Data persistence:** SQLite needs a persistent disk, and Render only offers disks on paid plans (the blueprint uses `starter`). On the free plan, delete the `disk:` block and the `DB_PATH` variable in `render.yaml`; the app works, but accounts and payments reset on every restart or redeploy.

## Environment variables
| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Port to listen on (Render sets it) | 3000 |
| `NODE_ENV` | `production` enables Secure cookies | unset |
| `DB_PATH` | SQLite file location | `./payments.db` |

## Algorithms and complexity
| Operation | Algorithm | Best | Average | Worst | Space |
|---|---|---|---|---|---|
| Add | Enqueue | O(1) | O(1) | O(1) | O(1) |
| Process | Dequeue | O(1) | O(1) | O(1) | O(1) |
| Search | Linear Search | O(1) | O(n) | O(n) | O(1) |
| Sort | Bubble Sort | O(n) | O(n²) | O(n²) | O(1) |

## Security
Helmet with strict CSP, rate limiting, scrypt password hashing, HttpOnly + SameSite=Strict (+ Secure in production) session cookie, login lockout after 5 failures, parameterised SQL, atomic money transfers, static-file whitelist.
