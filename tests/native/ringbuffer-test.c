// Standalone tests compile the production ringbuffer.c with only WDK types stubbed.
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#define VOID void
#define BYTE unsigned char
#define NTSTATUS int32_t
#include <sal.h>
#define ASSERT assert
#define RtlCopyMemory memcpy
#define STATUS_SUCCESS 0
#define STATUS_INTERNAL_ERROR ((int32_t)0xc00000e5)
#define STATUS_BUFFER_TOO_SMALL ((int32_t)0xc0000023)
#include "ringbuffer.h"
#include "ringbuffer-under-test.c"

// Small WDF adapter: execute the production pending-read loop with observable
// requests, including a reader that immediately issues its next read.
typedef unsigned char BOOLEAN;
#define MAXULONG UINT32_MAX
#define NT_SUCCESS(status) ((status) >= 0)
typedef struct {
    uint32_t ReadIntervalTimeout, ReadTotalTimeoutMultiplier, ReadTotalTimeoutConstant;
} SERIAL_TIMEOUTS;
typedef struct Request {
    BYTE data[8];
    size_t length, copied;
    NTSTATUS memoryStatus, status;
    unsigned completions;
} Request, *WDFREQUEST, *WDFMEMORY;
typedef struct { WDFREQUEST requests[4]; size_t next, count; } Queue;
typedef struct { RING_BUFFER RingBuffer; Queue *ReadQueue; } Context, *PQUEUE_CONTEXT;
static unsigned retrieves;
static NTSTATUS WdfIoQueueRetrieveNextRequest(Queue *queue, WDFREQUEST *request)
{
    assert(++retrieves < 10); // A single write must never spin on an empty read.
    if (queue->next == queue->count) return -1;
    *request = queue->requests[queue->next++];
    return 0;
}
static NTSTATUS WdfRequestRetrieveOutputMemory(WDFREQUEST request, WDFMEMORY *memory)
{
    *memory = request;
    return request->memoryStatus;
}
static void *WdfMemoryGetBuffer(WDFMEMORY memory, size_t *length)
{
    *length = memory->length;
    return memory->data;
}
static void WdfRequestCompleteWithInformation(WDFREQUEST request, NTSTATUS status, size_t copied)
{
    assert(request->completions++ == 0);
    request->status = status;
    request->copied = copied;
}
#include "read-queue.h"

static void testPendingReads(void)
{
    BYTE storage[1024], frame[] = "2,22,551";
    Queue queue = {0};
    Context context;
    SERIAL_TIMEOUTS timeouts = {0};
    unsigned round;
    context.ReadQueue = &queue;
    RingBufferInitialize(&context.RingBuffer, storage, sizeof(storage));
    assert(!ReadReturnsImmediately(&timeouts));
    timeouts.ReadIntervalTimeout = MAXULONG;
    assert(ReadReturnsImmediately(&timeouts));
    timeouts.ReadTotalTimeoutConstant = 1;
    assert(!ReadReturnsImmediately(&timeouts));
    timeouts.ReadTotalTimeoutConstant = 0;
    timeouts.ReadTotalTimeoutMultiplier = 1;
    assert(!ReadReturnsImmediately(&timeouts));
    for (round = 0; round < 1000000; ++round) {
        Request first = {0}, rest = {0}, waiting = {0}, invalid = {0};
        first.length = 1; rest.length = 7; waiting.length = 8;
        invalid.memoryStatus = -1;
        queue = (Queue){{&invalid, &first, &rest, &waiting}, 0, 4};
        retrieves = 0;
        DrainPendingReadsLocked(&context);
        assert(retrieves == 0); // Empty buffer must leave pending reads alone.
        assert(RingBufferWrite(&context.RingBuffer, frame, 8) == 0);
        DrainPendingReadsLocked(&context);
        assert(invalid.completions == 1 && invalid.status == -1);
        assert(first.copied == 1 && first.data[0] == frame[0]);
        assert(rest.copied == 7 && memcmp(rest.data, frame + 1, 7) == 0);
        assert(waiting.completions == 0 && queue.next == 3);
        // The next write must resume that same waiting request without reopening.
        assert(RingBufferWrite(&context.RingBuffer, frame, 8) == 0);
        DrainPendingReadsLocked(&context);
        assert(waiting.completions == 1 && waiting.copied == 8);
        assert(memcmp(waiting.data, frame, 8) == 0);
    }
    puts("PASS: 1,000,000 pending-read drain/resume cycles; immediate-read timeout modes");
}

int main(void)
{
    RING_BUFFER ring;
    BYTE storage[1024], output[1024];
    BYTE frame[] = "2,22,551";
    size_t copied, available, i, round;
    RingBufferInitialize(&ring, storage, sizeof(storage));
    for (i = 0; i < 127; ++i)
        assert(RingBufferWrite(&ring, frame, 8) == STATUS_SUCCESS);
    // The old implementation accepted seven bytes of frame 128, dropping one.
    assert(RingBufferWrite(&ring, frame, 8) == STATUS_BUFFER_TOO_SMALL);
    RingBufferGetAvailableData(&ring, &available);
    assert(available == 1016);
    assert(RingBufferRead(&ring, output, sizeof(output), &copied) == STATUS_SUCCESS);
    assert(copied == 1016);
    for (i = 0; i < copied; ++i) assert(output[i] == frame[i % 8]);

    // Retry after draining, repeatedly crossing the ring boundary.
    for (round = 0; round < 10000; ++round) {
        for (i = 0; i < 127; ++i)
            assert(RingBufferWrite(&ring, frame, 8) == STATUS_SUCCESS);
        assert(RingBufferRead(&ring, output, 509, &copied) == STATUS_SUCCESS);
        assert(copied == 509);
        for (i = 0; i < copied; ++i) assert(output[i] == frame[i % 8]);
        assert(RingBufferRead(&ring, output, sizeof(output), &copied) == STATUS_SUCCESS);
        assert(copied == 507);
        for (i = 0; i < copied; ++i) assert(output[i] == frame[(i + 509) % 8]);
    }
    memset(output, 0xa5, sizeof(output));
    assert(RingBufferWrite(&ring, output, 1024) == STATUS_BUFFER_TOO_SMALL);
    RingBufferGetAvailableData(&ring, &available);
    assert(available == 0);
    assert(RingBufferWrite(&ring, output, 1023) == STATUS_SUCCESS);
    assert(RingBufferWrite(&ring, frame, 1) == STATUS_BUFFER_TOO_SMALL);
    assert(RingBufferRead(&ring, output, sizeof(output), &copied) == STATUS_SUCCESS);
    assert(copied == 1023);
    for (i = 0; i < copied; ++i) assert(output[i] == 0xa5);
    puts("PASS: overflow is atomic; 1,270,000 frames preserved across wraparound and split reads");
    testPendingReads();
    return 0;
}
