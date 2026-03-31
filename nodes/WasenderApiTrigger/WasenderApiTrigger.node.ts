import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getSessions } from '../WasenderApi/listSearch/getSessions';
import { requestRetryOptions, sessionIdSelect } from '../WasenderApi/shared/descriptions';
import { wasenderApiRequest } from '../WasenderApi/shared/transport';

type WasenderResponse = IDataObject;

const webhookEventOptions = [
	{ name: 'Call', value: 'call' },
	{ name: 'Chat Delete', value: 'chats.delete' },
	{ name: 'Chat Update', value: 'chats.update' },
	{ name: 'Chat Upsert', value: 'chats.upsert' },
	{ name: 'Contact Update', value: 'contacts.update' },
	{ name: 'Contact Upsert', value: 'contacts.upsert' },
	{ name: 'Group Message Received', value: 'messages-group.received' },
	{ name: 'Group Participants Update', value: 'group-participants.update' },
	{ name: 'Group Update', value: 'groups.update' },
	{ name: 'Group Upsert', value: 'groups.upsert' },
	{ name: 'Message Deleted', value: 'messages.delete' },
	{ name: 'Message Reaction', value: 'messages.reaction' },
	{ name: 'Message Receipt Update', value: 'message-receipt.update' },
	{ name: 'Message Received', value: 'messages.received' },
	{ name: 'Message Sent', value: 'message.sent' },
	{ name: 'Message Status Update', value: 'messages.update' },
	{ name: 'Message Upsert', value: 'messages.upsert' },
	{ name: 'Newsletter Message Received', value: 'messages-newsletter.received' },
	{ name: 'Personal Message Received', value: 'messages-personal.received' },
	{ name: 'Poll Results', value: 'poll.results' },
	{ name: 'QR Code Updated', value: 'qrcode.updated' },
	{ name: 'Session Status', value: 'session.status' },
];

export class WasenderApiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WasenderAPI Trigger',
		name: 'wasenderApiTrigger',
		icon: {
			light: 'file:../../icons/wasenderapi.svg',
			dark: 'file:../../icons/wasenderapi.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		description: 'Start workflows from WasenderAPI webhook events',
		eventTriggerDescription: 'Trigger events from your WhatsApp session',
		activationMessage: 'Webhook registered on the selected WasenderAPI session.',
		defaults: { name: 'WasenderAPI Trigger' },
		usableAsTool: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'wasenderAccountApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			sessionIdSelect,
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: webhookEventOptions,
				default: ['messages.received'],
				description: 'Which events from your WhatsApp session should activate this trigger',
			},
			requestRetryOptions,
		],
	};

	methods = {
		listSearch: {
			getSessions,
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const session = await getSessionDetails.call(this);
				const webhookUrl = this.getNodeWebhookUrl('default');

				if (!webhookUrl) {
					return false;
				}

				return (
					Boolean(session.webhook_enabled) &&
					String(session.webhook_url ?? '') === webhookUrl &&
					areEventsConfigured(session.webhook_events, getSelectedEvents.call(this))
				);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');

				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'Webhook URL could not be determined');
				}

				await updateSessionWebhook.call(this, {
					webhook_enabled: true,
					webhook_events: getSelectedEvents.call(this),
					webhook_url: webhookUrl,
				});

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const session = await getSessionDetails.call(this);
				const webhookUrl = this.getNodeWebhookUrl('default');

				if (!webhookUrl || String(session.webhook_url ?? '') !== webhookUrl) {
					return true;
				}

				await updateSessionWebhook.call(this, {
					webhook_enabled: false,
				});

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData();
		const selectedEvents = getSelectedEvents.call(this);
		const session = await getSessionDetails.call(this);
		const webhookSecret = getWebhookSecretFromSession(session);
		const headerData = this.getHeaderData();
		const receivedSignature = headerData['x-webhook-signature'];

		if (webhookSecret && receivedSignature !== webhookSecret) {
			const response = this.getResponseObject();
			response.status(401).send('Invalid webhook signature');

			return { noWebhookResponse: true };
		}

		const eventName = String(body.event ?? '');
		if (selectedEvents.length > 0 && !selectedEvents.includes(eventName)) {
			return {
				webhookResponse: { ignored: true, received: true },
			};
		}

		const executionData: INodeExecutionData = {
			json: {
				...body,
				selectedSessionId: getSessionId.call(this),
				selectedSession: getSelectedSessionSummary(session),
				headers: headerData as unknown as IDataObject,
				params: this.getParamsData() as IDataObject,
				query: this.getQueryData() as IDataObject,
			},
		};

		return {
			webhookResponse: { received: true },
			workflowData: [[executionData]],
		};
	}
}

async function getSessionDetails(this: IHookFunctions | IWebhookFunctions): Promise<IDataObject> {
	const sessionId = getSessionId.call(this);
	const response = (await wasenderApiRequest.call(
		this,
		'wasenderAccountApi',
		'GET',
		`/whatsapp-sessions/${encodeURIComponent(sessionId)}`,
	)) as WasenderResponse;

	return (response.data as IDataObject) ?? {};
}

async function updateSessionWebhook(
	this: IHookFunctions,
	body: IDataObject,
): Promise<WasenderResponse> {
	const sessionId = getSessionId.call(this);

	return (await wasenderApiRequest.call(
		this,
		'wasenderAccountApi',
		'PUT',
		`/whatsapp-sessions/${encodeURIComponent(sessionId)}`,
		{ body },
	)) as WasenderResponse;
}

function getSessionId(this: IHookFunctions | IWebhookFunctions): string {
	return this.getNodeParameter('sessionId', '', { extractValue: true }) as string;
}

function getSelectedEvents(this: IHookFunctions | IWebhookFunctions): string[] {
	const events = this.getNodeParameter('events', []) as string[];

	return Array.isArray(events) ? events : [String(events)];
}

function getWebhookSecretFromSession(session: IDataObject): string | undefined {
	const secret = session.webhook_secret;

	if (typeof secret !== 'string') {
		return undefined;
	}

	const trimmedSecret = secret.trim();

	return trimmedSecret === '' ? undefined : trimmedSecret;
}

function getSelectedSessionSummary(session: IDataObject): IDataObject {
	return removeUndefined({
		id: session.id as string | number | undefined,
		name: getOptionalStringValue(session.name),
		phone_number: getOptionalStringValue(session.phone_number),
		status: getOptionalStringValue(session.status),
	});
}

function areEventsConfigured(currentEvents: unknown, selectedEvents: string[]): boolean {
	if (!Array.isArray(currentEvents)) {
		return selectedEvents.length === 0;
	}

	const normalizedCurrentEvents = currentEvents.map((event) => String(event));

	return (
		normalizedCurrentEvents.length === selectedEvents.length &&
		selectedEvents.every((event) => normalizedCurrentEvents.includes(event))
	);
}

function getOptionalStringValue(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmedValue = value.trim();
	return trimmedValue === '' ? undefined : trimmedValue;
}

function removeUndefined<T extends IDataObject>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entryValue]) => typeof entryValue !== 'undefined'),
	) as T;
}
