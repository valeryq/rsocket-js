/** Copyright (c) Facebook, Inc. and its affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @flow
 */

'use strict';

import type {ConnectionStatus, DuplexConnection, Frame} from 'rsocket-types';
import type {ISubject, ISubscriber, ISubscription} from 'rsocket-types';
import type {Encoders} from 'rsocket-core';

import {Flowable} from 'rsocket-flowable';
import {
  deserializeFrame,
  deserializeFrameWithLength,
  printFrame,
  serializeFrame,
  serializeFrameWithLength,
  toBuffer,
  FRAME_TYPES,
} from 'rsocket-core';
import {CONNECTION_STATUS} from 'rsocket-types';

export type ClientOptions = {|
  url: string,
  wsCreator?: (url: string) => WebSocket,
  debug?: boolean,
  lengthPrefixedFrames?: boolean,
  reconnectInterval?: number,
|};

/**
 * A WebSocket transport client for use in browser environments.
 */
export default class RSocketWebSocketClient implements DuplexConnection {
  _encoders: ?Encoders<*>;
  _options: ClientOptions;
  _receivers: Set<ISubscriber<Frame>>;
  _senders: Set<ISubscription>;
  _socket: ?WebSocket;
  _status: ConnectionStatus;
  _statusSubscribers: Set<ISubject<ConnectionStatus>>;
  _streamsToResubscribe: Map<number, Frame>;

  constructor(options: ClientOptions, encoders: ?Encoders<*>) {
    this._encoders = encoders;
    this._options = options;
    this._receivers = new Set();
    this._senders = new Set();
    this._socket = null;
    this._status = CONNECTION_STATUS.NOT_CONNECTED;
    this._statusSubscribers = new Set();
    this._streamsToResubscribe = new Map();
  }

  close(): void {
    this._close(undefined, true);
  }

  connect(): void {
    if (this._status.kind !== 'NOT_CONNECTED') {
      throw new Error(
        'RSocketWebSocketClient: Cannot connect(), a connection is already ' +
          'established.',
      );
    }
    this._setConnectionStatus(CONNECTION_STATUS.CONNECTING);

    const wsCreator = this._options.wsCreator;
    const url = this._options.url;
    this._socket = wsCreator ? wsCreator(url) : new WebSocket(url);

    const socket = this._socket;
    socket.binaryType = 'arraybuffer';

    (socket.addEventListener: $FlowIssue)('close', this._handleClosed);
    (socket.addEventListener: $FlowIssue)('error', this._handleError);
    (socket.addEventListener: $FlowIssue)('open', this._handleOpened);
    (socket.addEventListener: $FlowIssue)('message', this._handleMessage);
  }

  reconnect(): void {
    this._setConnectionStatus(CONNECTION_STATUS.RECONNECTING);

    // Remove all event listeners for existent socket connection
    if (this._socket) {
      const socket = this._socket;
      (socket.removeEventListener: $FlowIssue)('close', this._handleClosed);
      (socket.removeEventListener: $FlowIssue)('error', this._handleError);
      (socket.removeEventListener: $FlowIssue)('open', this._handleOpened);
      (socket.removeEventListener: $FlowIssue)('message', this._handleMessage);

      socket.close();
      this._socket = null;
    }

    setTimeout(() => {
      const {wsCreator} = this._options;
      const {url} = this._options;

      this._socket = wsCreator ? wsCreator(url) : new WebSocket(url);

      const socket = this._socket;
      socket.binaryType = 'arraybuffer';

      (socket.addEventListener: $FlowIssue)('close', this._handleClosed);
      (socket.addEventListener: $FlowIssue)('error', this._handleError);
      (socket.addEventListener: $FlowIssue)('open', this._handleOpened);
      (socket.addEventListener: $FlowIssue)('message', this._handleMessage);
    }, this._options.reconnectInterval || 0);
  }

  connectionStatus(): Flowable<ConnectionStatus> {
    return new Flowable(subscriber => {
      subscriber.onSubscribe({
        cancel: () => {
          this._statusSubscribers.delete(subscriber);
        },
        request: () => {
          this._statusSubscribers.add(subscriber);
          subscriber.onNext(this._status);
        },
      });
    });
  }

  receive(): Flowable<Frame> {
    return new Flowable(subject => {
      subject.onSubscribe({
        cancel: () => {
          this._receivers.delete(subject);
        },
        request: () => {
          this._receivers.add(subject);
        },
      });
    });
  }

  sendOne(frame: Frame): void {
    // Add stream to resubscribe map if frame type is stream or channel
    if ([FRAME_TYPES.REQUEST_STREAM, FRAME_TYPES.REQUEST_CHANNEL].includes(frame.type)) {
      this._streamsToResubscribe.set(frame.streamId, frame);
    }

    // Remove stream from resubscribe map if someone canceled stream
    if (frame.type === FRAME_TYPES.CANCEL && this._streamsToResubscribe.has(frame.streamId)) {
      this._streamsToResubscribe.delete(frame.streamId);
    }

    this._writeFrame(frame);
  }

  send(frames: Flowable<Frame>): void {
    let subscription;
    frames.subscribe({
      onComplete: () => {
        subscription && this._senders.delete(subscription);
      },
      onError: error => {
        subscription && this._senders.delete(subscription);
        this._close(error);
      },
      onNext: frame => this._writeFrame(frame),
      onSubscribe: _subscription => {
        subscription = _subscription;
        this._senders.add(subscription);
        subscription.request(Number.MAX_SAFE_INTEGER);
      },
    });
  }

  _close(error?: Error, force?: boolean) {
    // Reconnect if something went wrong with connection
    if (this._options.reconnectInterval && !force) {
      this.reconnect();

      return;
    }

    if (this._status.kind === 'CLOSED' || this._status.kind === 'ERROR') {
      // already closed
      return;
    }
    const status = error ? {error, kind: 'ERROR'} : CONNECTION_STATUS.CLOSED;
    this._setConnectionStatus(status);
    this._receivers.forEach(subscriber => {
      if (error) {
        subscriber.onError(error);
      } else {
        subscriber.onComplete();
      }
    });
    this._receivers.clear();
    this._senders.forEach(subscription => subscription.cancel());
    this._senders.clear();
    const socket = this._socket;
    if (socket) {
      (socket.removeEventListener: $FlowIssue)('close', this._handleClosed);
      (socket.removeEventListener: $FlowIssue)('error', this._handleError);
      (socket.removeEventListener: $FlowIssue)('open', this._handleOpened);
      (socket.removeEventListener: $FlowIssue)('message', this._handleMessage);
      socket.close();
      this._socket = null;
    }
  }

  _setConnectionStatus(status: ConnectionStatus): void {
    this._status = status;
    this._statusSubscribers.forEach(subscriber => subscriber.onNext(status));
  }

  _handleClosed = (e: {reason?: string}): void => {
    this._close(
      new Error(
        e.reason || 'RSocketWebSocketClient: Socket closed unexpectedly.',
      ),
    );
  };

  _handleError = (e: {error: Error}): void => {
    this._close(e.error);
  };

  _handleOpened = (): void => {
    this._setConnectionStatus(CONNECTION_STATUS.CONNECTED);

    // Try to re-subscribe last subscriptions by last sent frames
    this._streamsToResubscribe.forEach(frame => this.sendOne(frame));
  };

  _handleMessage = (message: MessageEvent): void => {
    try {
      const frame = this._readFrame(message);
      this._receivers.forEach(subscriber => subscriber.onNext(frame));
    } catch (error) {
      this._close(error);
    }
  };

  _readFrame(message: MessageEvent): Frame {
    const buffer = toBuffer(message.data);
    const frame = this._options.lengthPrefixedFrames
      ? deserializeFrameWithLength(buffer, this._encoders)
      : deserializeFrame(buffer, this._encoders);
    if (__DEV__) {
      if (this._options.debug) {
        console.log(printFrame(frame));
      }
    }
    return frame;
  }

  _writeFrame(frame: Frame): void {
    // Skip sending frame while connection status isn't CONNECTED
    if (this._status.kind !== 'CONNECTED') {
      return;
    }

    try {
      if (__DEV__) {
        if (this._options.debug) {
          console.log(printFrame(frame));
        }
      }
      const buffer = this._options.lengthPrefixedFrames
        ? serializeFrameWithLength(frame, this._encoders)
        : serializeFrame(frame, this._encoders);
      if (!this._socket) {
        throw new Error(
          'RSocketWebSocketClient: Cannot send frame, not connected.',
        );
      }
      this._socket.send(buffer);
    } catch (error) {
      this._close(error);
    }
  }
}
