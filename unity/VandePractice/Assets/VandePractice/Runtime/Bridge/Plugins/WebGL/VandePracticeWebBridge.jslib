mergeInto(LibraryManager.library, {
  // C# ABI: `string VandePracticeWebPendingOperationId()`.
  // `p` keeps the pointer return explicit (and pointer-width aware) while the
  // dependency list prevents Unity 6's Emscripten linker from stripping the
  // UTF-8 helpers or allocator used by the marshalled return value.
  VandePracticeWebPendingOperationId__sig: 'p',
  VandePracticeWebPendingOperationId__deps: [
    'malloc',
    '$lengthBytesUTF8',
    '$stringToUTF8'
  ],
  VandePracticeWebPendingOperationId: function () {
    try {
      var root = typeof globalThis !== 'undefined' ? globalThis : self;
      var host = root.VandeUnityPracticeWebHost;
      var value = host && typeof host.pendingOperationId === 'function'
        ? host.pendingOperationId()
        : host && host.pendingOperationId;
      if (typeof value !== 'string' || value.length === 0) return 0;
      var size = lengthBytesUTF8(value) + 1;
      var buffer = _malloc(size);
      stringToUTF8(value, buffer, size);
      return buffer;
    } catch (error) {
      console.error('VANDE Unity Web bridge could not read its operation id.', error);
      return 0;
    }
  },

  // C# ABI: `void VandePracticeWebRuntimeLoaded(string operationId)`.
  VandePracticeWebRuntimeLoaded__sig: 'vp',
  VandePracticeWebRuntimeLoaded__deps: ['$UTF8ToString'],
  VandePracticeWebRuntimeLoaded: function (operationIdPointer) {
    try {
      var root = typeof globalThis !== 'undefined' ? globalThis : self;
      var host = root.VandeUnityPracticeWebHost;
      if (!host || typeof host.runtimeLoadedFromUnity !== 'function') return;
      host.runtimeLoadedFromUnity(UTF8ToString(operationIdPointer));
    } catch (error) {
      console.error('VANDE Unity Web bridge could not report runtime load.', error);
    }
  },

  // C# ABI: `void VandePracticeWebEmit(string method, string operationId,
  //                                    string packet)`.
  VandePracticeWebEmit__sig: 'vppp',
  VandePracticeWebEmit__deps: ['$UTF8ToString'],
  VandePracticeWebEmit: function (methodPointer, operationIdPointer, packetPointer) {
    try {
      var root = typeof globalThis !== 'undefined' ? globalThis : self;
      var host = root.VandeUnityPracticeWebHost;
      if (!host) return;
      var method = UTF8ToString(methodPointer);
      var callback = host[method];
      if (typeof callback !== 'function') return;
      callback.call(
        host,
        UTF8ToString(operationIdPointer),
        UTF8ToString(packetPointer)
      );
    } catch (error) {
      console.error('VANDE Unity Web bridge could not emit a packet.', error);
    }
  }
});
