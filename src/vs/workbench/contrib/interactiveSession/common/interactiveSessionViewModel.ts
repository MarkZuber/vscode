/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IMarkdownString, MarkdownString } from 'vs/base/common/htmlContent';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IInteractiveRequestModel, IInteractiveResponseErrorDetails, IInteractiveResponseModel, IInteractiveSessionModel } from 'vs/workbench/contrib/interactiveSession/common/interactiveSessionModel';
import { IInteractiveSessionReplyFollowup, IInteractiveSessionResponseCommandFollowup, IInteractiveSessionService } from 'vs/workbench/contrib/interactiveSession/common/interactiveSessionService';
import { countWords } from 'vs/workbench/contrib/interactiveSession/common/interactiveSessionWordCounter';

export function isRequestVM(item: unknown): item is IInteractiveRequestViewModel {
	return !isResponseVM(item);
}

export function isResponseVM(item: unknown): item is IInteractiveResponseViewModel {
	return !!item && typeof (item as IInteractiveResponseViewModel).onDidChange !== 'undefined';
}

export interface IInteractiveSessionViewModel {
	sessionId: number;
	onDidDisposeModel: Event<void>;
	onDidChange: Event<void>;
	getItems(): (IInteractiveRequestViewModel | IInteractiveResponseViewModel)[];
}

export interface IInteractiveRequestViewModel {
	readonly id: string;
	readonly username: string;
	readonly avatarIconUri?: URI;
	readonly message: string;
	currentRenderedHeight: number | undefined;
}

export interface IInteractiveResponseRenderData {
	renderedWordCount: number;
	lastRenderTime: number;
	isFullyRendered: boolean;
}

export interface IInteractiveSessionLiveUpdateData {
	wordCountAfterLastUpdate: number;
	loadingStartTime: number;
	lastUpdateTime: number;
	impliedWordLoadRate: number;
}

export interface IInteractiveResponseViewModel {
	readonly onDidChange: Event<void>;
	readonly id: string;
	readonly providerId: string;
	readonly providerResponseId: string | undefined;
	readonly username: string;
	readonly avatarIconUri?: URI;
	readonly response: IMarkdownString;
	readonly isComplete: boolean;
	readonly isPlaceholder: boolean;
	readonly replyFollowups?: IInteractiveSessionReplyFollowup[];
	readonly commandFollowups?: IInteractiveSessionResponseCommandFollowup[];
	readonly errorDetails?: IInteractiveResponseErrorDetails;
	readonly progressiveResponseRenderingEnabled: boolean;
	readonly contentUpdateTimings?: IInteractiveSessionLiveUpdateData;
	renderData?: IInteractiveResponseRenderData;
	currentRenderedHeight: number | undefined;
}

export class InteractiveSessionViewModel extends Disposable implements IInteractiveSessionViewModel {
	private readonly _onDidDisposeModel = this._register(new Emitter<void>());
	readonly onDidDisposeModel = this._onDidDisposeModel.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _items: (IInteractiveRequestViewModel | IInteractiveResponseViewModel)[] = [];

	get sessionId() {
		return this._model.sessionId;
	}

	private readonly _progressiveResponseRenderingEnabled: boolean;
	get progressiveResponseRenderingEnabled(): boolean {
		return this._progressiveResponseRenderingEnabled;
	}

	constructor(
		private readonly _model: IInteractiveSessionModel,
		@IInteractiveSessionService private readonly interactiveSessionService: IInteractiveSessionService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._progressiveResponseRenderingEnabled = this.interactiveSessionService.progressiveRenderingEnabled(this._model.providerId);

		_model.getRequests().forEach((request, i) => {
			this._items.push(new InteractiveRequestViewModel(request));
			if (request.response) {
				this._items.push(this.instantiationService.createInstance(InteractiveResponseViewModel, request.response, this.progressiveResponseRenderingEnabled));
			}
		});

		this._register(_model.onDidDispose(() => this._onDidDisposeModel.fire()));
		this._register(_model.onDidChange(e => {
			if (e.kind === 'clear') {
				this._items.length = 0;
				this._onDidChange.fire();
			} else if (e.kind === 'addRequest') {
				this._items.push(new InteractiveRequestViewModel(e.request));
				if (e.request.response) {
					this.onAddResponse(e.request.response);
				}
			} else if (e.kind === 'addResponse') {
				this.onAddResponse(e.response);
			}

			this._onDidChange.fire();
		}));
	}

	private onAddResponse(responseModel: IInteractiveResponseModel) {
		const response = this.instantiationService.createInstance(InteractiveResponseViewModel, responseModel, this.progressiveResponseRenderingEnabled);
		this._register(response.onDidChange(() => this._onDidChange.fire()));
		this._items.push(response);
	}

	getItems() {
		return this._items;
	}

	override dispose() {
		super.dispose();
		this._items
			.filter((item): item is InteractiveResponseViewModel => item instanceof InteractiveResponseViewModel)
			.forEach((item: InteractiveResponseViewModel) => item.dispose());
	}
}

export class InteractiveRequestViewModel implements IInteractiveRequestViewModel {
	get id() {
		return this._model.id;
	}

	get username() {
		return this._model.username;
	}

	get avatarIconUri() {
		return this._model.avatarIconUri;
	}

	get message() {
		return this._model.message;
	}

	currentRenderedHeight: number | undefined;

	constructor(readonly _model: IInteractiveRequestModel) { }
}

export class InteractiveResponseViewModel extends Disposable implements IInteractiveResponseViewModel {
	private _changeCount = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _isPlaceholder = false;
	get isPlaceholder() {
		return this._isPlaceholder;
	}

	get id() {
		return this._model.id + `_${this._changeCount}`;
	}

	get providerId() {
		return this._model.providerId;
	}

	get providerResponseId() {
		return this._model.providerResponseId;
	}

	get username() {
		return this._model.username;
	}

	get avatarIconUri() {
		return this._model.avatarIconUri;
	}

	get response(): IMarkdownString {
		if (this._isPlaceholder) {
			return new MarkdownString('Thinking...');
		}

		return this._model.response;
	}

	get isComplete() {
		return this._model.isComplete;
	}

	get replyFollowups() {
		return this._model.followups?.filter((f): f is IInteractiveSessionReplyFollowup => f.kind === 'reply');
	}

	get commandFollowups() {
		return this._model.followups?.filter((f): f is IInteractiveSessionResponseCommandFollowup => f.kind === 'command');
	}

	get errorDetails() {
		return this._model.errorDetails;
	}

	renderData: IInteractiveResponseRenderData | undefined = undefined;

	currentRenderedHeight: number | undefined;

	private _contentUpdateTimings: IInteractiveSessionLiveUpdateData | undefined = undefined;
	get contentUpdateTimings(): IInteractiveSessionLiveUpdateData | undefined {
		return this._contentUpdateTimings;
	}

	constructor(
		private readonly _model: IInteractiveResponseModel,
		public readonly progressiveResponseRenderingEnabled: boolean,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._isPlaceholder = !_model.response.value && !_model.isComplete;

		if (!_model.isComplete) {
			this._contentUpdateTimings = {
				loadingStartTime: Date.now(),
				lastUpdateTime: Date.now(),
				wordCountAfterLastUpdate: this._isPlaceholder ? 0 : countWords(_model.response.value), // don't count placeholder text
				impliedWordLoadRate: 0
			};
		}

		this._register(_model.onDidChange(() => {
			if (this._isPlaceholder && (_model.response.value || this.isComplete)) {
				this._isPlaceholder = false;
				if (this.renderData) {
					this.renderData.renderedWordCount = 0;
				}
			}

			if (this._contentUpdateTimings) {
				// This should be true, if the model is changing
				const now = Date.now();
				const wordCount = countWords(_model.response.value);
				const timeDiff = now - this._contentUpdateTimings!.loadingStartTime;
				const impliedWordLoadRate = wordCount / (timeDiff / 1000);
				if (!this.isComplete) {
					this.trace('onDidChange', `Update- got ${wordCount} words over ${timeDiff}ms = ${impliedWordLoadRate} words/s. ${this.renderData?.renderedWordCount} words are rendered.`);
					this._contentUpdateTimings = {
						loadingStartTime: this._contentUpdateTimings!.loadingStartTime,
						lastUpdateTime: now,
						wordCountAfterLastUpdate: wordCount,
						// lastUpdateNewWordCount: wordCount - this._contentUpdateTimings!.wordCountAfterLastUpdate,
						// lastUpdateDuration: now - this._contentUpdateTimings!.lastUpdateTime, // none
						impliedWordLoadRate
					};
				} else {
					this.trace(`onDidChange`, `Done- got ${wordCount} words over ${timeDiff}ms = ${impliedWordLoadRate} words/s. ${this.renderData?.renderedWordCount} words are rendered.`);
				}
			} else {
				this.logService.warn('InteractiveResponseViewModel#onDidChange: got model update but contentUpdateTimings is not initialized');
			}

			// new data -> new id, new content to render
			this._changeCount++;
			if (this.renderData) {
				this.renderData.isFullyRendered = false;
				this.renderData.lastRenderTime = Date.now();
			}

			this._onDidChange.fire();
		}));
	}

	private trace(tag: string, message: string) {
		this.logService.trace(`InteractiveResponseViewModel#${tag}: ${message}`);
	}
}
