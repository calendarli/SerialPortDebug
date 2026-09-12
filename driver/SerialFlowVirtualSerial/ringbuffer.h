/*++

Copyright (C) Microsoft Corporation, All Rights Reserved

Module Name:

    Ringbuffer.h

--*/

#pragma once

typedef struct _RING_BUFFER
{
    //
    // The size in bytes of the ring buffer.
    //
    size_t          Size;

    //
    // A pointer to the base of the ring buffer.
    //
    BYTE*           Base;

    //
    // A pointer to the byte beyond the end of the ring buffer.  Used for
    // quick comparisons when determining if we need to wrap.
    //
    BYTE*           End;

    //
    // Read and write pointers. The caller must serialize all buffer access.
    // SerialFlow uses gPairLock for paired-port reads, writes and purges.
    // Writes that do not fit fail without modifying either pointer or data.
    //
    BYTE*           Head;

    BYTE*           Tail;

} RING_BUFFER, *PRING_BUFFER;


VOID
RingBufferInitialize(
    _In_  PRING_BUFFER      Self,
    _In_reads_bytes_(BufferSize)
          BYTE*             Buffer,
    _In_  size_t            BufferSize
    );

NTSTATUS
RingBufferWrite(
    _In_  PRING_BUFFER      Self,
    _In_reads_bytes_(DataSize)
          BYTE*             Data,
    _In_  size_t            DataSize
    );

NTSTATUS
RingBufferRead(
    _In_  PRING_BUFFER      Self,
    _Out_writes_bytes_to_(DataSize, *BytesCopied)
          BYTE*             Data,
    _In_  size_t            DataSize,
    _Out_ size_t            *BytesCopied
    );

VOID
RingBufferGetAvailableSpace(
    _In_  PRING_BUFFER      Self,
    _Out_ size_t            *AvailableSpace
    );

VOID
RingBufferGetAvailableData(
    _In_  PRING_BUFFER      Self,
    _Out_ size_t            *AvailableData
    );
