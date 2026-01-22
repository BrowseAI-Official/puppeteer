/**
 * @license
 * Copyright 2024 Google Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Protocol} from 'devtools-protocol';

import type {CDPSession} from '../api/CDPSession.js';
import {
  type ContinueRequestOverrides,
  headersArray,
  HTTPRequest,
  type ResponseForRequest,
  STATUS_TEXTS,
  handleError,
} from '../api/HTTPRequest.js';
import {stringToBase64} from '../util/encoding.js';

/**
 * Represents a request paused by the Fetch domain.
 *
 * @public
 */
export class FetchRequestPaused {
  readonly #client: CDPSession;
  readonly #event: Protocol.Fetch.RequestPausedEvent;
  #handled = false;

  /**
   * @internal
   */
  constructor(client: CDPSession, event: Protocol.Fetch.RequestPausedEvent) {
    this.#client = client;
    this.#event = event;
  }

  /**
   * The raw CDP `Fetch.requestPaused` event.
   */
  get event(): Protocol.Fetch.RequestPausedEvent {
    return this.#event;
  }

  /**
   * The request ID from the Fetch domain.
   */
  get requestId(): Protocol.Fetch.RequestId {
    return this.#event.requestId;
  }

  /**
   * The network request ID, if available.
   */
  get networkId(): Protocol.Network.RequestId | undefined {
    return this.#event.networkId;
  }

  /**
   * The request details.
   */
  get request(): Protocol.Network.Request {
    return this.#event.request;
  }

  /**
   * The frame ID that initiated the request.
   */
  get frameId(): Protocol.Page.FrameId | undefined {
    return this.#event.frameId;
  }

  /**
   * The resource type.
   */
  get resourceType(): Protocol.Network.ResourceType {
    return this.#event.resourceType;
  }

  /**
   * Whether this request has already been handled.
   */
  get handled(): boolean {
    return this.#handled;
  }

  /**
   * Continues the request with optional overrides.
   *
   * @param overrides - Optional request overrides.
   */
  async continue(overrides: ContinueRequestOverrides = {}): Promise<void> {
    if (this.#handled) {
      throw new Error('Request has already been handled');
    }
    this.#handled = true;

    const {url, method, postData, headers} = overrides;

    const postDataBinaryBase64 = postData
      ? stringToBase64(postData)
      : undefined;

    await this.#client
      .send('Fetch.continueRequest', {
        requestId: this.#event.requestId,
        url,
        method,
        postData: postDataBinaryBase64,
        headers: headers ? headersArray(headers) : undefined,
      })
      .catch(error => {
        this.#handled = false;
        return handleError(error);
      });
  }

  /**
   * Aborts the request.
   *
   * @param errorReason - Optional error reason. Defaults to 'Failed'.
   */
  async abort(
    errorReason: Protocol.Network.ErrorReason | null = null,
  ): Promise<void> {
    if (this.#handled) {
      throw new Error('Request has already been handled');
    }
    this.#handled = true;

    await this.#client
      .send('Fetch.failRequest', {
        requestId: this.#event.requestId,
        errorReason: errorReason || 'Failed',
      })
      .catch(error => {
        this.#handled = false;
        return handleError(error);
      });
  }

  /**
   * Fulfills the request with a custom response.
   *
   * @param response - Response data to fulfill the request with.
   */
  async respond(response: Partial<ResponseForRequest>): Promise<void> {
    if (this.#handled) {
      throw new Error('Request has already been handled');
    }
    this.#handled = true;

    let parsedBody:
      | {
          contentLength: number;
          base64: string;
        }
      | undefined;
    if (response.body) {
      parsedBody = HTTPRequest.getResponse(response.body);
    }

    const responseHeaders: Record<string, string | string[]> = {};
    if (response.headers) {
      for (const header of Object.keys(response.headers)) {
        const value = response.headers[header];

        responseHeaders[header.toLowerCase()] = Array.isArray(value)
          ? value.map(item => {
              return String(item);
            })
          : String(value);
      }
    }
    if (response.contentType) {
      responseHeaders['content-type'] = response.contentType;
    }
    if (parsedBody?.contentLength && !('content-length' in responseHeaders)) {
      responseHeaders['content-length'] = String(parsedBody.contentLength);
    }

    const status = response.status || 200;
    await this.#client
      .send('Fetch.fulfillRequest', {
        requestId: this.#event.requestId,
        responseCode: status,
        responsePhrase: STATUS_TEXTS[status],
        responseHeaders: headersArray(responseHeaders),
        body: parsedBody?.base64,
      })
      .catch(error => {
        this.#handled = false;
        return handleError(error);
      });
  }
}
