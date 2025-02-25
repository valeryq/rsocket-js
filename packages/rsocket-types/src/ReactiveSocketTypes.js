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

import type {Flowable, Single} from 'rsocket-flowable';

export interface Responder<D, M> {
  /**
   * Fire and Forget interaction model of `ReactiveSocket`. The returned
   * Publisher resolves when the passed `payload` is successfully handled.
   */
  fireAndForget(payload: Payload<D, M>): void,

  /**
   * Request-Response interaction model of `ReactiveSocket`. The returned
   * Publisher resolves with the response.
   */
  requestResponse(payload: Payload<D, M>): Single<Payload<D, M>>,

  /**
   * Request-Stream interaction model of `ReactiveSocket`. The returned
   * Publisher returns values representing the response(s).
   */
  requestStream(payload: Payload<D, M>): Flowable<Payload<D, M>>,

  /**
   * Request-Channel interaction model of `ReactiveSocket`. The returned
   * Publisher returns values representing the response(s).
   */
  requestChannel(payloads: Flowable<Payload<D, M>>): Flowable<Payload<D, M>>,

  /**
   * Metadata-Push interaction model of `ReactiveSocket`. The returned Publisher
   * resolves when the passed `payload` is successfully handled.
   */
  metadataPush(payload: Payload<D, M>): Single<void>,
}

export interface PartialResponder<D, M> {
  +fireAndForget?: (payload: Payload<D, M>) => void,
  +requestResponse?: (payload: Payload<D, M>) => Single<Payload<D, M>>,
  +requestStream?: (payload: Payload<D, M>) => Flowable<Payload<D, M>>,
  +requestChannel?: (
    payloads: Flowable<Payload<D, M>>,
  ) => Flowable<Payload<D, M>>,
  +metadataPush?: (payload: Payload<D, M>) => Single<void>,
}

/**
 * A contract providing different interaction models per the [ReactiveSocket protocol]
 (https://github.com/ReactiveSocket/reactivesocket/blob/master/Protocol.md).
 */
export interface ReactiveSocket<D, M> extends Responder<D, M> {
  /**
   * Close this `ReactiveSocket` and the underlying transport connection.
   */
  close(): void,

  /**
   * Returns a Flowable that immediately publishes the current connection
   * status and thereafter updates as it changes. Once a connection is in
   * the CLOSED or ERROR state, it may not be connected again.
   * Implementations must publish values per the comments on ConnectionStatus.
   */
  connectionStatus(): Flowable<ConnectionStatus>,

  /**
   * Returns positive number representing the availability of RSocket requester. Higher is better, 0.0
   * means not available.
   */
  availability(): number,
}

/**
 * Represents a network connection with input/output used by a ReactiveSocket to
 * send/receive data.
 */
export interface DuplexConnection {
  /**
   * Send a single frame on the connection.
   */
  sendOne(frame: Frame): void,

  /**
   * Send all the `input` frames on this connection.
   *
   * Notes:
   * - Implementations must not cancel the subscription.
   * - Implementations must signal any errors by calling `onError` on the
   *   `receive()` Publisher.
   */
  send(input: Flowable<Frame>): void,

  /**
   * Returns a stream of all `Frame`s received on this connection.
   *
   * Notes:
   * - Implementations must call `onComplete` if the underlying connection is
   *   closed by the peer or by calling `close()`.
   * - Implementations must call `onError` if there are any errors
   *   sending/receiving frames.
   * - Implemenations may optionally support multi-cast receivers. Those that do
   *   not should throw if `receive` is called more than once.
   */
  receive(): Flowable<Frame>,

  /**
   * Close the underlying connection, emitting `onComplete` on the receive()
   * Publisher.
   */
  close(): void,

  /**
   * Open the underlying connection. Throws if the connection is already in
   * the CLOSED or ERROR state.
   */
  connect(): void,

  /**
   * Reconnect the underlying connection.
   */
  reconnect(): void,

  /**
   * Returns a Flowable that immediately publishes the current connection
   * status and thereafter updates as it changes. Once a connection is in
   * the CLOSED or ERROR state, it may not be connected again.
   * Implementations must publish values per the comments on ConnectionStatus.
   */
  connectionStatus(): Flowable<ConnectionStatus>,
}

/**
 * Describes the connection status of a ReactiveSocket/DuplexConnection.
 * - NOT_CONNECTED: no connection established or pending.
 * - CONNECTING: when `connect()` has been called but a connection is not yet
 *   established.
 * - CONNECTED: when a connection is established.
 * - CLOSED: when the connection has been explicitly closed via `close()`.
 * - ERROR: when the connection has been closed for any other reason.
 */
export type ConnectionStatus =
  | {kind: 'NOT_CONNECTED'}
  | {kind: 'CONNECTING'}
  | {kind: 'RECONNECTING'}
  | {kind: 'CONNECTED'}
  | {kind: 'CLOSED'}
  | {kind: 'ERROR', error: Error};

export const CONNECTION_STATUS = {
  CLOSED: Object.freeze({kind: 'CLOSED'}),
  CONNECTED: Object.freeze({kind: 'CONNECTED'}),
  CONNECTING: Object.freeze({kind: 'CONNECTING'}),
  NOT_CONNECTED: Object.freeze({kind: 'NOT_CONNECTED'}),
  RECONNECTING: Object.freeze({kind: 'RECONNECTING'}),
};

/**
 * A type that can be written to a buffer.
 */
export type Encodable = string | Buffer | Uint8Array;

/**
 * A single unit of data exchanged between the peers of a `ReactiveSocket`.
 */
export type Payload<D, M> = {|
  data: ?D,
  metadata: ?M,
|};

export type Frame =
  | CancelFrame
  | ErrorFrame
  | KeepAliveFrame
  | LeaseFrame
  | PayloadFrame
  | MetadataPushFrame
  | RequestChannelFrame
  | RequestFnfFrame
  | RequestNFrame
  | RequestResponseFrame
  | RequestStreamFrame
  | ResumeFrame
  | ResumeOkFrame
  | SetupFrame
  | UnsupportedFrame;

export type FrameWithData = {
  data: ?Encodable,
  metadata: ?Encodable,
};

// prettier-ignore
export type CancelFrame = {|
  type: 0x09,
  flags: number,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type ErrorFrame = {|
  type: 0x0B,
  flags: number,
  code: number,
  message: string,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type KeepAliveFrame = {|
  type: 0x03,
  flags: number,
  data: ?Encodable,
  lastReceivedPosition: number,
  streamId: 0,
  length?: number,
|};
// prettier-ignore
export type LeaseFrame = {|
  type: 0x02,
  flags: number,
  ttl: number,
  requestCount: number,
  metadata: ?Encodable,
  streamId: 0,
  length?: number,
|};
// prettier-ignore
export type PayloadFrame = {|
  type: 0x0A,
  flags: number,
  data: ?Encodable,
  metadata: ?Encodable,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type MetadataPushFrame = {|
  type: 0x0C,
  metadata: ?Encodable,
  flags: number,
  streamId: 0,
  length?: number,
|};
// prettier-ignore
export type RequestChannelFrame = {|
  type: 0x07,
  data: ?Encodable,
  metadata: ?Encodable,
  flags: number,
  requestN: number,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type RequestFnfFrame = {|
  type: 0x05,
  data: ?Encodable,
  metadata: ?Encodable,
  flags: number,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type RequestNFrame = {|
  type: 0x08,
  flags: number,
  requestN: number,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type RequestResponseFrame = {|
  type: 0x04,
  data: ?Encodable,
  metadata: ?Encodable,
  flags: number,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type RequestStreamFrame = {|
  type: 0x06,
  data: ?Encodable,
  metadata: ?Encodable,
  flags: number,
  requestN: number,
  streamId: number,
  length?: number,
|};
// prettier-ignore
export type ResumeFrame = {|
  type: 0x0d,
  clientPosition: number,
  flags: number,
  majorVersion: number,
  minorVersion: number,
  resumeToken: Encodable,
  serverPosition: number,
  streamId: 0,
  length?: number,
|};
// prettier-ignore
export type ResumeOkFrame = {|
  type: 0x0e,
  clientPosition: number,
  flags: number,
  streamId: 0,
  length?: number,
|};
// prettier-ignore
export type SetupFrame = {|
  type: 0x01,
  data: ?Encodable,
  dataMimeType: string,
  flags: number,
  keepAlive: number,
  lifetime: number,
  metadata: ?Encodable,
  metadataMimeType: string,
  resumeToken: ?Encodable,
  streamId: 0,
  majorVersion: number,
  minorVersion: number,
  length?: number,
|};
// prettier-ignore
export type UnsupportedFrame = {|
  type: 0x3f | 0x00,
  streamId: 0,
  flags: number,
  length?: number,
|};
