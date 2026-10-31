# Password recovery email setup

## Local/offline demonstration (default)

In your private .env:

```dotenv
MAIL_MODE=file
MAIL_OUTBOX_DIR=.local/outbox
MAIL_FROM=Brightloop <demo@brightloop.local>
APP_URL=http://localhost:5173
```

Restart the API after environment changes. Use Forgot password on the login screen
and enter an existing active user's email. The API deliberately gives the same
message for existing and unknown accounts. Local files are not public web pages:
open .local/outbox in the editor or an email viewer and copy the reset URL from
the latest .eml file. Nodemailer may wrap long lines using quoted-printable MIME:
an email viewer decodes this; when copying manually, remove soft line breaks
(an = at the end of a line) and decode =3D as = if present. Keep the full #token= part.

These files contain working reset links. The default .local directory is ignored
by Git and is not served by the app. Never point MAIL_OUTBOX_DIR at client/public,
dist/client or another publicly served/shared directory. File delivery is an
offline demo channel and does not claim delivery to the recipient's real inbox.

## Real inbox delivery through SMTP

Use the host, sender and credentials issued by your email provider. Example for
STARTTLS on port 587 (replace placeholders privately):

```dotenv
MAIL_MODE=smtp
MAIL_FROM=Brightloop <verified-sender@example.com>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=your-provider-username
SMTP_PASS=your-provider-password-or-app-password
APP_URL=https://your-app.example.com
```

For implicit TLS on port 465, set SMTP_PORT=465 and SMTP_SECURE=true. Production
requires HTTPS reset links and encrypted SMTP; certificate validation stays on.
SMTP logs/debugging are disabled. There is no need to share SMTP credentials in chat
or commit .env. For a local SMTP catcher only, development can use localhost:1025
with SMTP_REQUIRE_TLS=false and empty credentials.

Verify your provider allows the configured MAIL_FROM sender. Actual external inbox
delivery requires real provider settings; automated checks only send to a local
test SMTP server. They do not contact a real provider or send external emails.

## Behavior and troubleshooting

- Links last 30 minutes and work once. Resetting signs out all sessions for that account.
- Existing signed-in browsers can open a reset link; successful reset clears the
  current browser cookie too. Sign in again explicitly after success.
- Repeated forgot requests within 60 seconds do not send duplicate emails. Request
  again after the cooldown to replace the previous link.
- Delivery runs in-process after token creation so SMTP latency does not delay the
  public response differently for existing accounts. Failed delivery invalidates
  its token and emits a fixed, content-free diagnostic. The public response stays
  generic. There is no durable delivery queue or automatic retry after a crash;
  request another link after the cooldown if the process stopped during delivery.
- Check MAIL_MODE, private outbox, provider settings, API terminal diagnostic and
  APP_URL when no link arrives. No reset token or raw email is printed to logs.
- Request links use APP_URL, never the incoming Host header. The token is a URL
  fragment, is removed from the visible browser URL on load and is sent only in
  the reset POST body. Do not paste real links into issues, screenshots or logs.
