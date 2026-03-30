import type { INodeProperties } from 'n8n-workflow';

import { createPaginationFields, sessionIdSelect, showFor } from '../../shared/descriptions';

const accountOperationsWithSession = [
	'get',
	'update',
	'delete',
	'connect',
	'disconnect',
	'restart',
	'getQrCode',
	'getMessageLogs',
	'getSessionLogs',
	'regenerateKey',
];

const sessionMutationOperations = ['create', 'update'];

export const accountDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('account'),
		options: [
			{
				name: 'Connect Whatsapp Session',
				value: 'connect',
				action: 'Connect whatsapp session',
			},
			{
				name: 'Create Whatsapp Session',
				value: 'create',
				action: 'Create whatsapp session',
			},
			{
				name: 'Delete Whatsapp Session',
				value: 'delete',
				action: 'Delete whatsapp session',
			},
			{
				name: 'Disconnect Whatsapp Session',
				value: 'disconnect',
				action: 'Disconnect whatsapp session',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many whatsapp sessions',
			},
			{
				name: 'Get Message Logs',
				value: 'getMessageLogs',
				action: 'Get message logs for session',
			},
			{
				name: 'Get QR Code',
				value: 'getQrCode',
				action: 'Get session qr code',
			},
			{
				name: 'Get Session Logs',
				value: 'getSessionLogs',
				action: 'Get session logs',
			},
			{
				name: 'Get Whatsapp Session',
				value: 'get',
				action: 'Get whatsapp session',
			},
			{
				name: 'Regenerate Session API Key',
				value: 'regenerateKey',
				action: 'Regenerate session api key',
			},
			{
				name: 'Restart Whatsapp Session',
				value: 'restart',
				action: 'Restart whatsapp session',
			},
			{
				name: 'Update Whatsapp Session',
				value: 'update',
				action: 'Update whatsapp session',
			},
		],
		default: 'getAll',
	},
	{
		...sessionIdSelect,
		displayOptions: showFor('account', accountOperationsWithSession),
	},
	{
		displayName: 'Name',
		name: 'sessionName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		default: '',
		required: true,
		placeholder: '+1234567789',
		description: 'Use the international phone number format',
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Account Protection',
		name: 'accountProtection',
		type: 'boolean',
		default: true,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Log Messages',
		name: 'logMessages',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Read Incoming Messages',
		name: 'readIncomingMessages',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Webhook Enabled',
		name: 'webhookEnabled',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Webhook URL',
		name: 'webhookUrl',
		type: 'string',
		default: '',
		placeholder: 'https://example.com/wasender/webhook',
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Webhook Events',
		name: 'webhookEvents',
		type: 'json',
		default: '["messages.received", "session.status"]',
		description: 'Provide an array of webhook event names',
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Auto Reject Calls',
		name: 'autoRejectCalls',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Always Online',
		name: 'alwaysOnline',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Ignore Groups',
		name: 'ignoreGroups',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Ignore Broadcasts',
		name: 'ignoreBroadcasts',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Ignore Channels',
		name: 'ignoreChannels',
		type: 'boolean',
		default: false,
		displayOptions: showFor('account', sessionMutationOperations),
	},
	{
		displayName: 'Proxy URL',
		name: 'proxyUrl',
		type: 'string',
		default: '',
		placeholder: 'http://proxy.example.com:8080',
		displayOptions: showFor('account', sessionMutationOperations),
	},
	...createPaginationFields('account', ['getMessageLogs', 'getSessionLogs']),
	{
		displayName: 'Status',
		name: 'messageLogStatus',
		type: 'options',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Sent', value: 'sent' },
			{ name: 'Failed', value: 'failed' },
			{ name: 'In Progress', value: 'in_progress' },
		],
		default: '',
		displayOptions: showFor('account', ['getMessageLogs']),
	},
];
