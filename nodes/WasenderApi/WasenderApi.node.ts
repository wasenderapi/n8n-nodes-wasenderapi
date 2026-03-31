import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { accountDescription } from './resources/account';
import { contactDescription } from './resources/contact';
import { groupDescription } from './resources/group';
import { messageDescription } from './resources/message';
import { sessionDescription } from './resources/session';
import { getContacts } from './listSearch/getContacts';
import { getGroups } from './listSearch/getGroups';
import { getSessions } from './listSearch/getSessions';
import { requestRetryOptions, sessionIdSelect } from './shared/descriptions';
import { wasenderApiRequest } from './shared/transport';

type WasenderCredentialType = 'wasenderAccountApi' | 'selectedSession' | 'none';
type WasenderResource = 'account' | 'session' | 'message' | 'contact' | 'group';
type WasenderResponse = IDataObject;

const supportedDecryptMediaTypes = [
	'imageMessage',
	'videoMessage',
	'audioMessage',
	'documentMessage',
	'stickerMessage',
] as const;

const nestedDecryptMessageKeys = [
	'message',
	'ephemeralMessage',
	'viewOnceMessage',
	'viewOnceMessageV2',
	'viewOnceMessageV2Extension',
	'documentWithCaptionMessage',
	'editedMessage',
	'keepInChatMessage',
] as const;

type SupportedDecryptMediaType = (typeof supportedDecryptMediaTypes)[number];

interface BufferLike {
	readonly buffer: ArrayBufferLike;
	readonly byteOffset: number;
	readonly byteLength: number;
}

declare const Buffer: {
	isBuffer(value: unknown): value is BufferLike;
	from(data: ArrayBuffer): BufferLike;
	from(data: ArrayBufferLike, byteOffset?: number, length?: number): BufferLike;
	from(data: string, encoding?: string): BufferLike;
};

interface NodeExecutionDataResult {
	__executionData: INodeExecutionData[];
}

interface NormalizedDecryptMediaPayload {
	requestBody: IDataObject;
	messageId: string;
	mediaType: SupportedDecryptMediaType;
	mimeType?: string;
	fileName?: string;
}

export class WasenderApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WasenderAPI',
		name: 'wasenderApi',
		icon: {
			light: 'file:../../icons/wasenderapi.svg',
			dark: 'file:../../icons/wasenderapi.dark.svg',
		},
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage WasenderAPI sessions, messages, contacts, and groups',
		defaults: { name: 'WasenderAPI' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'wasenderAccountApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Group', value: 'group' },
					{ name: 'Message', value: 'message' },
					{ name: 'Session', value: 'session' },
				],
				default: 'message',
			},
			{
				...sessionIdSelect,
				required: false,
				description:
					'Optional at execution time when the input item includes selectedSessionId; select a session here if you want contact or group lists in the editor',
				displayOptions: {
					show: {
						resource: ['session', 'message', 'contact', 'group'],
					},
				},
			},
			{
				displayName: 'Auto Selected Session ID',
				name: 'autoSelectedSessionId',
				type: 'hidden',
				default: '={{$json.selectedSessionId ?? $json.selectedSession?.id ?? ""}}',
				displayOptions: {
					show: {
						resource: ['session', 'message', 'contact', 'group'],
					},
				},
			},
			{
				displayName: 'Has Auto Selected Session',
				name: 'hasAutoSelectedSession',
				type: 'hidden',
				default: '={{Boolean($json.selectedSessionId ?? $json.selectedSession?.id ?? "")}}',
				displayOptions: {
					show: {
						resource: ['session', 'message', 'contact', 'group'],
					},
				},
			},
			{
				displayName:
					'This node will use the session from the incoming item automatically unless you choose another session below.',
				name: 'autoSelectedSessionNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						resource: ['session', 'message', 'contact', 'group'],
						hasAutoSelectedSession: [true],
					},
				},
			},
			...accountDescription,
			...sessionDescription,
			...messageDescription,
			...contactDescription,
			...groupDescription,
			requestRetryOptions,
		],
	};

	methods = {
		listSearch: {
			getSessions,
			getContacts,
			getGroups,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as WasenderResource;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				const responseData = await executeOperation.call(this, resource, operation, itemIndex);

				if (isNodeExecutionDataResult(responseData)) {
					returnData.push(...responseData.__executionData);
					continue;
				}

				returnData.push(...toExecutionData(responseData, itemIndex));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}

async function executeOperation(
	this: IExecuteFunctions,
	resource: WasenderResource,
	operation: string,
	itemIndex: number,
): Promise<unknown | NodeExecutionDataResult> {
	switch (resource) {
		case 'account':
			return await executeAccountOperation.call(this, operation, itemIndex);
		case 'session':
			return await executeSessionOperation.call(this, operation, itemIndex);
		case 'message':
			return await executeMessageOperation.call(this, operation, itemIndex);
		case 'contact':
			return await executeContactOperation.call(this, operation, itemIndex);
		case 'group':
			return await executeGroupOperation.call(this, operation, itemIndex);
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`);
	}
}

async function executeAccountOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<unknown> {
	switch (operation) {
		case 'getAll': {
			const response = (await wasenderApiRequest.call(
				this,
				'wasenderAccountApi',
				'GET',
				'/whatsapp-sessions',
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'create': {
			const response = (await wasenderApiRequest.call(
				this,
				'wasenderAccountApi',
				'POST',
				'/whatsapp-sessions',
				{ body: getSessionMutationBody.call(this, itemIndex) },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'get': {
			const sessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
			const response = (await wasenderApiRequest.call(
				this,
				'wasenderAccountApi',
				'GET',
				`/whatsapp-sessions/${encodeURIComponent(sessionId)}`,
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'update': {
			const sessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
			const response = (await wasenderApiRequest.call(
				this,
				'wasenderAccountApi',
				'PUT',
				`/whatsapp-sessions/${encodeURIComponent(sessionId)}`,
				{ body: getSessionMutationBody.call(this, itemIndex) },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'delete': {
			const sessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
			const response = (await wasenderApiRequest.call(
				this,
				'wasenderAccountApi',
				'DELETE',
				`/whatsapp-sessions/${encodeURIComponent(sessionId)}`,
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'connect':
		case 'disconnect':
		case 'restart':
		case 'regenerateKey': {
			const sessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
			const endpointByOperation: Record<string, string> = {
				connect: 'connect',
				disconnect: 'disconnect',
				restart: 'restart',
				regenerateKey: 'regenerate-key',
			};

			const response = (await wasenderApiRequest.call(
				this,
				'wasenderAccountApi',
				'POST',
				`/whatsapp-sessions/${encodeURIComponent(sessionId)}/${endpointByOperation[operation]}`,
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'getQrCode': {
			const sessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
			const response = (await wasenderApiRequest.call(
				this,
				'wasenderAccountApi',
				'GET',
				`/whatsapp-sessions/${encodeURIComponent(sessionId)}/qrcode`,
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'getMessageLogs': {
			const sessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
			return await getPaginatedApiItems.call(this, itemIndex, {
				credentialType: 'wasenderAccountApi',
				endpoint: `/whatsapp-sessions/${encodeURIComponent(sessionId)}/message-logs`,
				limitQueryName: 'per_page',
				additionalQuery: {
					status: getOptionalStringParameter.call(this, 'messageLogStatus', itemIndex),
				},
			});
		}
		case 'getSessionLogs': {
			const sessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
			return await getPaginatedApiItems.call(this, itemIndex, {
				credentialType: 'wasenderAccountApi',
				endpoint: `/whatsapp-sessions/${encodeURIComponent(sessionId)}/session-logs`,
				limitQueryName: 'per_page',
			});
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported account operation: ${operation}`);
	}
}

async function executeSessionOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<unknown> {
	const sessionId = getSelectedSessionId.call(this, itemIndex);

	switch (operation) {
		case 'getStatus': {
			const response = (await wasenderApiRequest.call(this, 'selectedSession', 'GET', '/status', {
				sessionId,
			})) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'getUserInfo': {
			const response = (await wasenderApiRequest.call(this, 'selectedSession', 'GET', '/user', {
				sessionId,
			})) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'sendPresenceUpdate': {
			const delayMs = this.getNodeParameter('delayMs', itemIndex) as number;
			const body: IDataObject = {
				jid: this.getNodeParameter('presenceJid', itemIndex) as string,
				type: this.getNodeParameter('presenceType', itemIndex) as string,
			};

			if (delayMs > 0) {
				body.delayMs = delayMs;
			}

			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				'POST',
				'/send-presence-update',
				{ body, sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported session operation: ${operation}`);
	}
}

async function executeMessageOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<unknown> {
	const sessionId = getSelectedSessionId.call(this, itemIndex);

	switch (operation) {
		case 'sendText':
		case 'sendImage':
		case 'sendVideo':
		case 'sendDocument':
		case 'sendAudio':
		case 'sendSticker':
		case 'sendContact':
		case 'sendLocation':
		case 'sendPoll': {
			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				'POST',
				'/send-message',
				{ body: getSendMessageBody.call(this, operation, itemIndex), sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'uploadMedia': {
			const uploadPayload = getJsonParameter.call(this, 'uploadPayload', itemIndex);
			ensureObjectValue(this, uploadPayload, 'Upload Payload');

			const response = (await wasenderApiRequest.call(this, 'selectedSession', 'POST', '/upload', {
				body: uploadPayload as IDataObject,
				sessionId,
			})) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'decryptMedia': {
			return await executeDecryptMediaOperation.call(this, itemIndex);
		}
		case 'getInfo':
		case 'edit':
		case 'delete':
		case 'resend': {
			const msgId = this.getNodeParameter('msgId', itemIndex) as number;

			if (!msgId) {
				throw new NodeOperationError(this.getNode(), 'Message ID is required', { itemIndex });
			}

			const configByOperation: Record<
				string,
				{ method: 'GET' | 'PUT' | 'DELETE' | 'POST'; endpoint: string; body?: IDataObject }
			> = {
				getInfo: { method: 'GET', endpoint: `/messages/${msgId}/info` },
				edit: {
					method: 'PUT',
					endpoint: `/messages/${msgId}`,
					body: {
						text: this.getNodeParameter('newText', itemIndex) as string,
					},
				},
				delete: { method: 'DELETE', endpoint: `/messages/${msgId}` },
				resend: { method: 'POST', endpoint: `/messages/${msgId}/resend` },
			};

			const requestConfig = configByOperation[operation];
			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				requestConfig.method,
				requestConfig.endpoint,
				requestConfig.body ? { body: requestConfig.body, sessionId } : { sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'markAsRead': {
			const key = getJsonParameter.call(this, 'messageKey', itemIndex);
			ensureObjectValue(this, key, 'Message Key');

			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				'POST',
				'/messages/read',
				{
					sessionId,
					body: { key: key as IDataObject },
				},
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported message operation: ${operation}`);
	}
}

async function executeContactOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<unknown | NodeExecutionDataResult> {
	const sessionId = getSelectedSessionId.call(this, itemIndex);

	switch (operation) {
		case 'getAll':
			return await getPaginatedApiItems.call(this, itemIndex, {
				credentialType: 'selectedSession',
				endpoint: '/contacts',
				paginatedQueryName: 'paginated',
				itemsProperty: 'items',
				paginationProperty: 'pagination',
				limitQueryName: 'limit',
			});
		case 'get':
		case 'block':
		case 'unblock': {
			const contactJid = getResourceLocatorValue.call(this, 'contactJid', itemIndex);
			const endpointByOperation: Record<string, string> = {
				get: `/contacts/${encodeURIComponent(contactJid)}`,
				block: `/contacts/${encodeURIComponent(contactJid)}/block`,
				unblock: `/contacts/${encodeURIComponent(contactJid)}/unblock`,
			};
			const methodByOperation: Record<string, 'GET' | 'POST'> = {
				get: 'GET',
				block: 'POST',
				unblock: 'POST',
			};

			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				methodByOperation[operation],
				endpointByOperation[operation],
				{ sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'getPicture': {
			const contactJid = getResourceLocatorValue.call(this, 'contactJid', itemIndex);
			return await executeProfilePictureOperation.call(
				this,
				itemIndex,
				sessionId,
				`/contacts/${encodeURIComponent(contactJid)}/picture`,
				contactJid,
				'contact',
			);
		}
		case 'upsert': {
			const response = (await wasenderApiRequest.call(this, 'selectedSession', 'PUT', '/contacts', {
				sessionId,
				body: removeUndefined({
					jid: getResourceLocatorValue.call(this, 'contactJid', itemIndex),
					fullName: getOptionalStringParameter.call(this, 'fullName', itemIndex),
					saveOnPrimaryAddressbook: this.getNodeParameter(
						'saveOnPrimaryAddressbook',
						itemIndex,
					) as boolean,
				}),
			})) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'checkOnWhatsApp':
		case 'getLidFromPhone':
		case 'getPhoneFromLid': {
			const phoneOrJid = this.getNodeParameter(
				operation === 'getPhoneFromLid' ? 'lid' : 'phoneOrJid',
				itemIndex,
			) as string;
			const endpointByOperation: Record<string, string> = {
				checkOnWhatsApp: `/on-whatsapp/${encodeURIComponent(phoneOrJid)}`,
				getLidFromPhone: `/lid-from-pn/${encodeURIComponent(phoneOrJid)}`,
				getPhoneFromLid: `/pn-from-lid/${encodeURIComponent(phoneOrJid)}`,
			};

			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				'GET',
				endpointByOperation[operation],
				{ sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported contact operation: ${operation}`);
	}
}

async function executeGroupOperation(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<unknown | NodeExecutionDataResult> {
	const sessionId = getSelectedSessionId.call(this, itemIndex);

	switch (operation) {
		case 'getAll':
			return await getPaginatedApiItems.call(this, itemIndex, {
				credentialType: 'selectedSession',
				endpoint: '/groups',
				paginatedQueryName: 'paginated',
				itemsProperty: 'items',
				paginationProperty: 'pagination',
				limitQueryName: 'limit',
			});
		case 'create': {
			const response = (await wasenderApiRequest.call(this, 'selectedSession', 'POST', '/groups', {
				sessionId,
				body: removeUndefined({
					name: this.getNodeParameter('groupName', itemIndex) as string,
					participants: getStringListParameter.call(this, 'participants', itemIndex),
				}),
			})) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'getMetadata':
		case 'getParticipants':
		case 'getInviteLink':
		case 'leave': {
			const groupJid = getResourceLocatorValue.call(this, 'groupJid', itemIndex);
			const pathByOperation: Record<string, string> = {
				getMetadata: `/groups/${encodeURIComponent(groupJid)}/metadata`,
				getParticipants: `/groups/${encodeURIComponent(groupJid)}/participants`,
				getInviteLink: `/groups/${encodeURIComponent(groupJid)}/invite-link`,
				leave: `/groups/${encodeURIComponent(groupJid)}/leave`,
			};
			const methodByOperation: Record<string, 'GET' | 'POST'> = {
				getMetadata: 'GET',
				getParticipants: 'GET',
				getInviteLink: 'GET',
				leave: 'POST',
			};

			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				methodByOperation[operation],
				pathByOperation[operation],
				{ sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'getPicture': {
			const groupJid = getResourceLocatorValue.call(this, 'groupJid', itemIndex);
			return await executeProfilePictureOperation.call(
				this,
				itemIndex,
				sessionId,
				`/groups/${encodeURIComponent(groupJid)}/picture`,
				groupJid,
				'group',
			);
		}
		case 'addParticipants':
		case 'removeParticipants':
		case 'updateParticipants': {
			const groupJid = getResourceLocatorValue.call(this, 'groupJid', itemIndex);
			const participants = getStringListParameter.call(this, 'participants', itemIndex);

			if (participants.length === 0) {
				throw new NodeOperationError(this.getNode(), 'At least one participant is required', {
					itemIndex,
				});
			}

			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				operation === 'updateParticipants' ? 'PUT' : 'POST',
				`/groups/${encodeURIComponent(groupJid)}/participants/${
					operation === 'addParticipants'
						? 'add'
						: operation === 'removeParticipants'
							? 'remove'
							: 'update'
				}`,
				{
					sessionId,
					body:
						operation === 'updateParticipants'
							? {
									action: this.getNodeParameter('participantAction', itemIndex) as string,
									participants,
								}
							: { participants },
				},
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'updateSettings': {
			const groupJid = getResourceLocatorValue.call(this, 'groupJid', itemIndex);
			const settings = this.getNodeParameter('settings', itemIndex, {}) as IDataObject;
			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				'PUT',
				`/groups/${encodeURIComponent(groupJid)}/settings`,
				{
					sessionId,
					body: removeUndefined(settings),
				},
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'getInviteInfo': {
			const inviteCode = this.getNodeParameter('inviteCode', itemIndex) as string;
			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				'GET',
				`/groups/invite/${encodeURIComponent(inviteCode)}`,
				{ sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		case 'acceptInvite': {
			const inviteCode = this.getNodeParameter('inviteCode', itemIndex) as string;
			const response = (await wasenderApiRequest.call(
				this,
				'selectedSession',
				'POST',
				'/groups/invite/accept',
				{ body: { code: inviteCode }, sessionId },
			)) as WasenderResponse;

			return extractResponsePayload(response);
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported group operation: ${operation}`);
	}
}

function getSessionMutationBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
	return removeUndefined({
		name: this.getNodeParameter('sessionName', itemIndex) as string,
		phone_number: this.getNodeParameter('phoneNumber', itemIndex) as string,
		account_protection: this.getNodeParameter('accountProtection', itemIndex) as boolean,
		log_messages: this.getNodeParameter('logMessages', itemIndex) as boolean,
		read_incoming_messages: this.getNodeParameter('readIncomingMessages', itemIndex) as boolean,
		webhook_enabled: this.getNodeParameter('webhookEnabled', itemIndex) as boolean,
		webhook_url: getOptionalStringParameter.call(this, 'webhookUrl', itemIndex),
		webhook_events: getStringArrayFromJsonParameter.call(this, 'webhookEvents', itemIndex),
		auto_reject_calls: this.getNodeParameter('autoRejectCalls', itemIndex) as boolean,
		always_online: this.getNodeParameter('alwaysOnline', itemIndex) as boolean,
		ignore_groups: this.getNodeParameter('ignoreGroups', itemIndex) as boolean,
		ignore_broadcasts: this.getNodeParameter('ignoreBroadcasts', itemIndex) as boolean,
		ignore_channels: this.getNodeParameter('ignoreChannels', itemIndex) as boolean,
		proxy_url: getOptionalStringParameter.call(this, 'proxyUrl', itemIndex),
	});
}

function getSendMessageBody(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): IDataObject {
	const to = this.getNodeParameter('to', itemIndex) as string;
	const text = getOptionalStringParameter.call(this, 'text', itemIndex);
	const messageOptions = this.getNodeParameter('messageOptions', itemIndex, {}) as IDataObject;
	const mentions = getStringListParameter.call(this, 'mentions', itemIndex);

	const body: IDataObject = { to };

	if (text) {
		body.text = text;
	}

	if (typeof messageOptions.replyTo !== 'undefined') {
		const replyTo = Number(messageOptions.replyTo);

		if (!Number.isInteger(replyTo) || replyTo < 1) {
			throw new NodeOperationError(
				this.getNode(),
				'Reply To Message ID must be a positive integer',
				{
					itemIndex,
				},
			);
		}

		body.replyTo = replyTo;
	}

	if (mentions.length > 0) {
		body.mentions = mentions;
	}

	switch (operation) {
		case 'sendText':
			if (!text) {
				throw new NodeOperationError(this.getNode(), 'Text is required for Send Text');
			}
			break;
		case 'sendImage':
			body.imageUrl = this.getNodeParameter('imageUrl', itemIndex) as string;
			appendViewOnceFlag.call(this, body, itemIndex);
			break;
		case 'sendVideo':
			body.videoUrl = this.getNodeParameter('videoUrl', itemIndex) as string;
			appendViewOnceFlag.call(this, body, itemIndex);
			break;
		case 'sendDocument':
			body.documentUrl = this.getNodeParameter('documentUrl', itemIndex) as string;
			body.fileName = getOptionalStringParameter.call(this, 'fileName', itemIndex);
			break;
		case 'sendAudio':
			body.audioUrl = this.getNodeParameter('audioUrl', itemIndex) as string;
			appendViewOnceFlag.call(this, body, itemIndex);
			break;
		case 'sendSticker':
			body.stickerUrl = this.getNodeParameter('stickerUrl', itemIndex) as string;
			break;
		case 'sendContact':
			body.contact = {
				name: this.getNodeParameter('contactName', itemIndex) as string,
				phone: this.getNodeParameter('contactPhone', itemIndex) as string,
			};
			break;
		case 'sendLocation':
			body.location = removeUndefined({
				latitude: this.getNodeParameter('latitude', itemIndex) as number,
				longitude: this.getNodeParameter('longitude', itemIndex) as number,
				name: getOptionalStringParameter.call(this, 'locationName', itemIndex),
				address: getOptionalStringParameter.call(this, 'address', itemIndex),
			});
			break;
		case 'sendPoll': {
			const options = getStringListParameter.call(this, 'pollOptions', itemIndex);

			if (options.length < 2) {
				throw new NodeOperationError(this.getNode(), 'A poll requires at least two options', {
					itemIndex,
				});
			}

			body.poll = {
				question: this.getNodeParameter('pollQuestion', itemIndex) as string,
				options,
				multiSelect: this.getNodeParameter('pollMultiSelect', itemIndex) as boolean,
			};
			break;
		}
	}

	return removeUndefined(body);
}

function appendViewOnceFlag(this: IExecuteFunctions, body: IDataObject, itemIndex: number): void {
	if (this.getNodeParameter('viewOnce', itemIndex) as boolean) {
		body.viewOnce = true;
	}
}

async function getPaginatedApiItems(
	this: IExecuteFunctions,
	itemIndex: number,
	config: {
		credentialType: WasenderCredentialType;
		endpoint: string;
		paginatedQueryName?: string;
		itemsProperty?: string;
		paginationProperty?: string;
		limitQueryName: string;
		additionalQuery?: IDataObject;
	},
): Promise<unknown[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, true) as boolean;
	const page = this.getNodeParameter('page', itemIndex, 1) as number;
	const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
	const queryLimit = Math.max(1, limit);

	if (!returnAll) {
		const response = (await wasenderApiRequest.call(
			this,
			config.credentialType,
			'GET',
			config.endpoint,
			{
				sessionId:
					config.credentialType === 'selectedSession'
						? getSelectedSessionId.call(this, itemIndex)
						: undefined,
				qs: removeUndefined({
					[config.paginatedQueryName ?? 'paginated']: config.paginatedQueryName ? true : undefined,
					page,
					[config.limitQueryName]: queryLimit,
					...(config.additionalQuery ?? {}),
				}),
			},
		)) as WasenderResponse;

		return extractPaginatedItems(response, config.itemsProperty, config.paginationProperty);
	}

	const allItems: unknown[] = [];
	let currentPage = 1;
	let hasNextPage = true;

	while (hasNextPage) {
		const response = (await wasenderApiRequest.call(
			this,
			config.credentialType,
			'GET',
			config.endpoint,
			{
				sessionId:
					config.credentialType === 'selectedSession'
						? getSelectedSessionId.call(this, itemIndex)
						: undefined,
				qs: removeUndefined({
					[config.paginatedQueryName ?? 'paginated']: config.paginatedQueryName ? true : undefined,
					page: currentPage,
					[config.limitQueryName]: 100,
					...(config.additionalQuery ?? {}),
				}),
			},
		)) as WasenderResponse;

		const currentItems = extractPaginatedItems(
			response,
			config.itemsProperty,
			config.paginationProperty,
		);
		allItems.push(...currentItems);

		hasNextPage = hasNextPaginatedResponse(
			response,
			config.itemsProperty,
			config.paginationProperty,
		);
		currentPage += 1;
	}

	return allItems;
}

function extractPaginatedItems(
	response: WasenderResponse,
	itemsProperty = 'data',
	paginationProperty = 'pagination',
): unknown[] {
	const payload = response.data;

	if (Array.isArray(payload)) {
		return payload;
	}

	if (!isObject(payload)) {
		return [];
	}

	const typedPayload = payload as IDataObject;
	const items = typedPayload[itemsProperty];

	if (Array.isArray(items)) {
		return items;
	}

	if (itemsProperty === 'data' && Array.isArray(typedPayload.data)) {
		return typedPayload.data as unknown[];
	}

	const paginationPayload = typedPayload[paginationProperty];
	if (isObject(paginationPayload) && Array.isArray((paginationPayload as IDataObject).items)) {
		return (paginationPayload as IDataObject).items as unknown[];
	}

	return [];
}

function hasNextPaginatedResponse(
	response: WasenderResponse,
	itemsProperty = 'data',
	paginationProperty = 'pagination',
): boolean {
	const payload = response.data;

	if (!isObject(payload)) {
		return false;
	}

	const typedPayload = payload as IDataObject;
	const pagination = typedPayload[paginationProperty];

	if (isObject(pagination)) {
		const paginationInfo = pagination as IDataObject;
		const totalPages = Number(paginationInfo.totalPages ?? 1);
		const page = Number(paginationInfo.page ?? 1);
		return page < totalPages;
	}

	if (Array.isArray(typedPayload[itemsProperty]) && typeof typedPayload.last_page !== 'undefined') {
		const currentPage = Number(typedPayload.current_page ?? 1);
		const lastPage = Number(typedPayload.last_page ?? currentPage);
		return currentPage < lastPage;
	}

	return false;
}

function extractResponsePayload(response: WasenderResponse): unknown {
	if (typeof response.data !== 'undefined') {
		if (isObject(response.data) && Array.isArray((response.data as IDataObject).data)) {
			return (response.data as IDataObject).data;
		}

		if (isObject(response.data) && Array.isArray((response.data as IDataObject).items)) {
			return (response.data as IDataObject).items;
		}

		return response.data;
	}

	const clonedResponse = { ...response };
	delete clonedResponse.success;
	return clonedResponse;
}

function toExecutionData(payload: unknown, itemIndex: number): INodeExecutionData[] {
	if (Array.isArray(payload)) {
		return payload.map((entry) => ({
			json: toDataObject(entry),
			pairedItem: { item: itemIndex },
		}));
	}

	return [
		{
			json: toDataObject(payload),
			pairedItem: { item: itemIndex },
		},
	];
}

function toDataObject(value: unknown): IDataObject {
	if (isObject(value)) {
		return value as IDataObject;
	}

	if (typeof value === 'undefined') {
		return {};
	}

	return { value: value as string | number | boolean | null };
}

async function executeProfilePictureOperation(
	this: IExecuteFunctions,
	itemIndex: number,
	sessionId: string,
	endpoint: string,
	resourceId: string,
	resourceType: 'contact' | 'group',
): Promise<NodeExecutionDataResult> {
	const response = (await wasenderApiRequest.call(this, 'selectedSession', 'GET', endpoint, {
		sessionId,
	})) as WasenderResponse;
	const responsePayload = extractResponsePayload(response);
	const pictureUrl = getProfilePictureUrl.call(this, responsePayload, resourceType, itemIndex);
	const mimeType = getMimeTypeFromUrl(pictureUrl);
	const fileName = buildProfilePictureFileName(resourceType, resourceId, mimeType, pictureUrl);
	const binaryData = await downloadBinaryData.call(
		this,
		pictureUrl,
		fileName,
		mimeType,
		itemIndex,
		'profile picture',
	);

	return {
		__executionData: [
			{
				json: removeUndefined({
					...toDataObject(responsePayload),
					resourceType,
					resourceId,
					pictureUrl,
					mimeType,
					fileName,
				}),
				binary: {
					data: binaryData,
				},
				pairedItem: { item: itemIndex },
			},
		],
	};
}

async function executeDecryptMediaOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<NodeExecutionDataResult> {
	const decryptPayload = getDecryptPayload.call(this, itemIndex);
	const normalizedPayload = normalizeDecryptMediaPayload.call(this, decryptPayload, itemIndex);
	const response = (await wasenderApiRequest.call(
		this,
		'selectedSession',
		'POST',
		'/decrypt-media',
		{
			body: normalizedPayload.requestBody,
			sessionId: getSelectedSessionId.call(this, itemIndex),
		},
	)) as WasenderResponse;
	const responsePayload = extractResponsePayload(response);
	const publicUrl = getDecryptMediaPublicUrl.call(this, responsePayload, itemIndex);
	const binaryData = await downloadBinaryData.call(
		this,
		publicUrl,
		normalizedPayload.fileName,
		normalizedPayload.mimeType,
		itemIndex,
		'decrypted media',
	);

	return {
		__executionData: [
			{
				json: removeUndefined({
					...toDataObject(responsePayload),
					messageId: normalizedPayload.messageId,
					mediaType: normalizedPayload.mediaType,
					mimeType: normalizedPayload.mimeType,
					fileName: normalizedPayload.fileName,
					publicUrl,
				}),
				binary: {
					data: binaryData,
				},
				pairedItem: { item: itemIndex },
			},
		],
	};
}

function getDecryptPayload(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const payloadSource = this.getNodeParameter('decryptPayloadSource', itemIndex, 'auto') as string;
	const inputItemJson = this.getInputData()[itemIndex]?.json;

	if (payloadSource === 'manual') {
		const manualPayload = getJsonParameter.call(this, 'decryptPayload', itemIndex);
		ensureObjectValue(this, manualPayload, 'Webhook Payload');
		return manualPayload;
	}

	if (isObject(inputItemJson) && Object.keys(inputItemJson).length > 0) {
		return inputItemJson;
	}

	const savedManualPayload = getRawJsonParameter.call(this, 'decryptPayload', itemIndex);

	if (isObject(savedManualPayload)) {
		return savedManualPayload;
	}

	throw new NodeOperationError(
		this.getNode(),
		'No webhook payload found. Connect the webhook item to this node or switch Payload Source to Manual JSON',
		{ itemIndex },
	);
}

function normalizeDecryptMediaPayload(
	this: IExecuteFunctions,
	payload: IDataObject,
	itemIndex: number,
): NormalizedDecryptMediaPayload {
	const messageEntry = findDecryptMessageEntry(payload);

	if (!messageEntry) {
		throw new NodeOperationError(
			this.getNode(),
			'Decrypt payload must contain a Wasender webhook payload with a supported media message',
			{ itemIndex },
		);
	}

	const messageId = getMessageIdFromDecryptPayload(messageEntry);

	if (!messageId) {
		throw new NodeOperationError(
			this.getNode(),
			'Decrypt payload must include data.messages.key.id from the webhook payload',
			{ itemIndex },
		);
	}

	const messageValue = isObject(messageEntry.message) ? messageEntry.message : messageEntry;
	const mediaMessage = findSupportedDecryptMediaMessage(messageValue);

	if (!mediaMessage) {
		throw new NodeOperationError(
			this.getNode(),
			'No supported media object found. Expected image, video, audio, document, or sticker message data',
			{ itemIndex },
		);
	}

	const mimeType = getOptionalObjectString(mediaMessage.media, 'mimetype');
	const fileName = buildDecryptMediaFileName(
		messageId,
		mediaMessage.type,
		getOptionalObjectString(mediaMessage.media, 'fileName'),
		mimeType,
	);

	return {
		requestBody: {
			data: {
				messages: {
					key: {
						id: messageId,
					},
					message: {
						[mediaMessage.type]: mediaMessage.media,
					},
				},
			},
		},
		messageId,
		mediaType: mediaMessage.type,
		mimeType,
		fileName,
	};
}

function findDecryptMessageEntry(value: unknown): IDataObject | undefined {
	if (Array.isArray(value)) {
		for (const entry of value) {
			const resolvedEntry = findDecryptMessageEntry(entry);

			if (resolvedEntry) {
				return resolvedEntry;
			}
		}

		return undefined;
	}

	if (!isObject(value)) {
		return undefined;
	}

	const typedValue = value as IDataObject;
	if (isObject(typedValue.message) && findSupportedDecryptMediaMessage(typedValue.message)) {
		return typedValue;
	}

	if (
		(isObject(typedValue.key) || typeof typedValue.id !== 'undefined') &&
		findSupportedDecryptMediaMessage(typedValue)
	) {
		return typedValue;
	}

	for (const nestedValue of Object.values(typedValue)) {
		const resolvedEntry = findDecryptMessageEntry(nestedValue);

		if (resolvedEntry) {
			return resolvedEntry;
		}
	}

	return undefined;
}

function findSupportedDecryptMediaMessage(
	value: unknown,
): { type: SupportedDecryptMediaType; media: IDataObject } | undefined {
	if (!isObject(value)) {
		return undefined;
	}

	const typedValue = value as IDataObject;

	for (const mediaType of supportedDecryptMediaTypes) {
		const mediaValue = typedValue[mediaType];

		if (isObject(mediaValue)) {
			return {
				type: mediaType,
				media: mediaValue as IDataObject,
			};
		}
	}

	for (const nestedKey of nestedDecryptMessageKeys) {
		const nestedValue = typedValue[nestedKey];

		const nestedMediaMessage = findSupportedDecryptMediaMessage(nestedValue);

		if (nestedMediaMessage) {
			return nestedMediaMessage;
		}
	}

	return undefined;
}

function getMessageIdFromDecryptPayload(value: IDataObject): string | undefined {
	if (isObject(value.key)) {
		const keyId = getOptionalObjectString(value.key as IDataObject, 'id');

		if (keyId) {
			return keyId;
		}
	}

	return getOptionalObjectString(value, 'id');
}

function getDecryptMediaPublicUrl(
	this: IExecuteFunctions,
	payload: unknown,
	itemIndex: number,
): string {
	if (isObject(payload)) {
		const publicUrl = getOptionalObjectString(payload as IDataObject, 'publicUrl');

		if (publicUrl) {
			return publicUrl;
		}
	}

	throw new NodeOperationError(
		this.getNode(),
		'Decrypt media response did not include a publicUrl',
		{
			itemIndex,
		},
	);
}

function getProfilePictureUrl(
	this: IExecuteFunctions,
	payload: unknown,
	resourceType: 'contact' | 'group',
	itemIndex: number,
): string {
	if (isObject(payload)) {
		const pictureUrl =
			getOptionalObjectString(payload as IDataObject, 'imgUrl') ??
			getOptionalObjectString(payload as IDataObject, 'pictureUrl') ??
			getOptionalObjectString(payload as IDataObject, 'url') ??
			getOptionalObjectString(payload as IDataObject, 'publicUrl');

		if (pictureUrl) {
			return pictureUrl;
		}
	}

	throw new NodeOperationError(
		this.getNode(),
		`Get ${resourceType} profile picture response did not include an image URL`,
		{
			itemIndex,
		},
	);
}

async function downloadBinaryData(
	this: IExecuteFunctions,
	url: string,
	fileName: string | undefined,
	mimeType: string | undefined,
	itemIndex: number,
	errorContext = 'media file',
): Promise<IBinaryData> {
	try {
		const requestOptions: IHttpRequestOptions = {
			url,
			method: 'GET',
			json: false,
			encoding: 'arraybuffer',
		};
		const responseBody = await this.helpers.httpRequest(requestOptions);

		return await this.helpers.prepareBinaryData(
			toBinaryBuffer.call(this, responseBody, itemIndex) as Parameters<
				typeof this.helpers.prepareBinaryData
			>[0],
			fileName,
			mimeType,
		);
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Failed to download ${errorContext}: ${(error as Error).message}`,
			{
				itemIndex,
			},
		);
	}
}

function toBinaryBuffer(this: IExecuteFunctions, value: unknown, itemIndex: number): unknown {
	if (Buffer.isBuffer(value)) {
		return value;
	}

	if (value instanceof ArrayBuffer) {
		return Buffer.from(value);
	}

	if (ArrayBuffer.isView(value)) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}

	if (typeof value === 'string') {
		return Buffer.from(value, 'binary');
	}

	throw new NodeOperationError(
		this.getNode(),
		'Unexpected response while downloading binary data',
		{
			itemIndex,
		},
	);
}

function buildDecryptMediaFileName(
	messageId: string,
	mediaType: SupportedDecryptMediaType,
	originalFileName: string | undefined,
	mimeType: string | undefined,
): string {
	if (originalFileName) {
		return originalFileName;
	}

	const extension = getFileExtensionFromMimeType(mimeType);

	if (extension) {
		return `${messageId}.${extension}`;
	}

	return `${messageId}-${mediaType}`;
}

function buildProfilePictureFileName(
	resourceType: 'contact' | 'group',
	resourceId: string,
	mimeType: string | undefined,
	url: string,
): string {
	const extension = getFileExtensionFromMimeType(mimeType) ?? getFileExtensionFromUrl(url) ?? 'jpg';
	const sanitizedResourceId = resourceId.replace(/[^a-zA-Z0-9._-]+/g, '_');

	return `${resourceType}-${sanitizedResourceId}.${extension}`;
}

function getFileExtensionFromMimeType(mimeType: string | undefined): string | undefined {
	if (!mimeType) {
		return undefined;
	}

	const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
	const mappedExtensions: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif',
		'video/mp4': 'mp4',
		'audio/ogg': 'ogg',
		'audio/mpeg': 'mp3',
		'audio/mp4': 'm4a',
		'application/pdf': 'pdf',
		'application/msword': 'doc',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
		'application/vnd.ms-excel': 'xls',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
		'text/plain': 'txt',
		'application/zip': 'zip',
	};

	if (mappedExtensions[normalizedMimeType]) {
		return mappedExtensions[normalizedMimeType];
	}

	const [, subtype] = normalizedMimeType.split('/');

	if (subtype && /^[a-z0-9.+-]{1,10}$/i.test(subtype)) {
		return subtype.replace(/^x-/, '');
	}

	return undefined;
}

function getMimeTypeFromUrl(url: string): string | undefined {
	const extension = getFileExtensionFromUrl(url)?.toLowerCase();
	const mappedMimeTypes: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		webp: 'image/webp',
		gif: 'image/gif',
	};

	return extension ? mappedMimeTypes[extension] : undefined;
}

function getFileExtensionFromUrl(url: string): string | undefined {
	const normalizedUrl = url.split(/[?#]/, 1)[0];
	const match = normalizedUrl.match(/\.([a-zA-Z0-9]+)$/);

	return match?.[1];
}

function getOptionalObjectString(value: IDataObject, key: string): string | undefined {
	const entryValue = value[key];

	if (typeof entryValue !== 'string') {
		return undefined;
	}

	const trimmedValue = entryValue.trim();
	return trimmedValue === '' ? undefined : trimmedValue;
}

function isNodeExecutionDataResult(value: unknown): value is NodeExecutionDataResult {
	return isObject(value) && Array.isArray((value as IDataObject).__executionData);
}

function getResourceLocatorValue(this: IExecuteFunctions, name: string, itemIndex: number): string {
	return this.getNodeParameter(name, itemIndex, '', { extractValue: true }) as string;
}

function getSelectedSessionId(this: IExecuteFunctions, itemIndex: number): string {
	const explicitSessionId = getResourceLocatorValue.call(this, 'sessionId', itemIndex);
	const autoSelectedSessionId = this.getNodeParameter('autoSelectedSessionId', itemIndex, '') as
		| string
		| number;
	const inputJson = this.getInputData()[itemIndex]?.json;

	const resolvedSessionId =
		normalizeSessionIdValue(explicitSessionId) ??
		normalizeSessionIdValue(autoSelectedSessionId) ??
		getSelectedSessionIdFromInput(inputJson);

	if (resolvedSessionId) {
		return resolvedSessionId;
	}

	throw new NodeOperationError(
		this.getNode(),
		'Session is required. Select a session or provide selectedSessionId in the input data',
		{ itemIndex },
	);
}

function getSelectedSessionIdFromInput(inputJson: unknown): string | undefined {
	if (!isObject(inputJson)) {
		return undefined;
	}

	return (
		normalizeSessionIdValue(inputJson.selectedSessionId) ??
		(isObject(inputJson.selectedSession)
			? normalizeSessionIdValue((inputJson.selectedSession as IDataObject).id)
			: undefined)
	);
}

function normalizeSessionIdValue(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmedValue = value.trim();
		return trimmedValue === '' ? undefined : trimmedValue;
	}

	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}

	return undefined;
}

function getOptionalStringParameter(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
): string | undefined {
	const value = this.getNodeParameter(name, itemIndex, '') as string;
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

function getJsonParameter(this: IExecuteFunctions, name: string, itemIndex: number): unknown {
	return parseJsonParameterValue.call(
		this,
		name,
		this.getNodeParameter(name, itemIndex),
		itemIndex,
	);
}

function getRawJsonParameter(this: IExecuteFunctions, name: string, itemIndex: number): unknown {
	const rawValue = this.getNode().parameters[name];
	const valueToParse =
		typeof rawValue === 'string' && rawValue.startsWith('=')
			? this.evaluateExpression(rawValue, itemIndex)
			: rawValue;

	return parseJsonParameterValue.call(this, name, valueToParse, itemIndex);
}

function parseJsonParameterValue(
	this: IExecuteFunctions,
	name: string,
	value: unknown,
	itemIndex: number,
): unknown {
	if (typeof value !== 'string') {
		return value;
	}

	const trimmed = value.trim();

	if (trimmed === '') {
		return undefined;
	}

	try {
		return JSON.parse(trimmed);
	} catch (error) {
		throw new NodeOperationError(
			this.getNode(),
			`Invalid JSON in ${name}: ${(error as Error).message}`,
			{
				itemIndex,
			},
		);
	}
}

function getStringArrayFromJsonParameter(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
): string[] | undefined {
	const value = getJsonParameter.call(this, name, itemIndex);

	if (typeof value === 'undefined') {
		return undefined;
	}

	if (!Array.isArray(value)) {
		throw new NodeOperationError(this.getNode(), `${name} must be a JSON array of strings`, {
			itemIndex,
		});
	}

	return value.map((entry) => String(entry)).filter((entry) => entry.trim() !== '');
}

function getStringListParameter(
	this: IExecuteFunctions,
	name: string,
	itemIndex: number,
): string[] {
	const value = this.getNodeParameter(name, itemIndex, {}) as IDataObject;
	const entries = (value.values ?? []) as IDataObject[];

	return entries.map((entry) => String(entry.value ?? '').trim()).filter((entry) => entry !== '');
}

function ensureObjectValue(
	context: IExecuteFunctions,
	value: unknown,
	displayName: string,
): asserts value is IDataObject {
	if (!isObject(value)) {
		throw new NodeOperationError(context.getNode(), `${displayName} must be a JSON object`);
	}
}

function removeUndefined<T extends IDataObject>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entryValue]) => typeof entryValue !== 'undefined'),
	) as T;
}

function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
