# n8n-nodes-wasenderapi-official

This is an n8n community node package for [WasenderAPI](https://wasenderapi.com/).

It lets you manage Whatsapp sessions, send messages, work with contacts and groups, and trigger workflows from WasenderAPI webhooks.

[Installation](#installation)  
[Nodes](#nodes)  
[Credentials](#credentials)  
[Usage Notes](#usage-notes)  
[Compatibility](#compatibility)  
[Resources](#resources)

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/), then install:

```bash
npm install n8n-nodes-wasenderapi-official
```

Package name:

```text
n8n-nodes-wasenderapi-official
```

## Nodes

This package includes two nodes.

### WasenderAPI

Use this node for direct WasenderAPI actions.

Supported resource groups:

- `Account`: list, create, update, connect, disconnect, restart, get QR code, regenerate API key, read session logs, read message logs
- `Session`: get status, get current user, send presence updates
- `Message`: send text, image, video, document, audio, sticker, contact, location, and poll messages; upload media; decrypt webhook media straight from the incoming item into n8n binary data; edit, delete, resend, inspect, and mark messages as read
- `Contact`: list contacts, get contact info, get profile picture, create/update contacts, block/unblock contacts, resolve Whatsapp/LID lookups
- `Group`: list groups, create groups, inspect metadata and participants, manage participants, update settings, retrieve invite data, and leave groups

### WasenderAPI Trigger

Use this trigger to start workflows from WasenderAPI webhook events.

Supported event subscriptions include:

- message events like `messages.received`, `messages.upsert`, `messages.update`, `messages.delete`, `message.sent`
- chat, group, and contact events
- session and QR events like `session.status` and `qrcode.updated`
- call and poll events like `call` and `poll.results`

## Credentials

This package provides one credential type.

### WasenderAPI Account API

Use a personal access token for account-level endpoints such as:

- listing or updating Whatsapp sessions
- generating session QR codes
- configuring webhook settings for the trigger node

## Usage Notes

- Session-scoped actions use the selected session automatically, so you only need to connect the account credential and choose a session in the node
- The trigger node configures the selected WasenderAPI session webhook URL automatically during activation and validates incoming signatures with that session's stored webhook secret
- WasenderAPI uses one webhook URL per session, so activating a trigger can overwrite webhook settings previously configured elsewhere for that same session
- Trigger output includes `selectedSessionId`, so downstream WasenderAPI nodes can prefill the same session while still letting you change it
- The action node supports resource locators for sessions, contacts, and groups so you can select items from live dropdowns instead of pasting IDs manually

## Compatibility

- Built as an n8n community node package using the current `n8nNodesApiVersion: 1`
- Verified in this repository with `npm run lint` and `npm run build`

## Resources

- [WasenderAPI documentation](https://wasenderapi.com/api-docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Version History

### 0.1.0

- Initial release with WasenderAPI action node and webhook trigger node
