// The caller holds gPairLock throughout these operations.
#pragma once

static BOOLEAN
ReadReturnsImmediately(const SERIAL_TIMEOUTS *Timeouts)
{
    return Timeouts->ReadIntervalTimeout == MAXULONG &&
        Timeouts->ReadTotalTimeoutMultiplier == 0 &&
        Timeouts->ReadTotalTimeoutConstant == 0;
}

static VOID
DrainPendingReadsLocked(PQUEUE_CONTEXT Context)
{
    for (;;) {
        size_t available, length, copied = 0;
        WDFREQUEST request;
        WDFMEMORY memory;
        NTSTATUS status;
        BYTE *buffer;

        RingBufferGetAvailableData(&Context->RingBuffer, &available);
        if (!available) return;
        status = WdfIoQueueRetrieveNextRequest(Context->ReadQueue, &request);
        if (!NT_SUCCESS(status)) return;

        // Consume bytes directly. Forwarding back to the dispatch queue can
        // synchronously run EvtIoRead and requeue the same empty read forever.
        status = WdfRequestRetrieveOutputMemory(request, &memory);
        if (NT_SUCCESS(status)) {
            buffer = (BYTE *)WdfMemoryGetBuffer(memory, &length);
            if (length) status = RingBufferRead(&Context->RingBuffer, buffer, length, &copied);
        }
        WdfRequestCompleteWithInformation(request, status, NT_SUCCESS(status) ? copied : 0);
    }
}
