package com.zepmed.printer;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@ReactModule(name = ZepMedPrinterModule.NAME)
public class ZepMedPrinterModule extends ReactContextBaseJavaModule {
  public static final String NAME = "ZepMedPrinter";
  private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
  private static final int CHUNK = 120;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  public ZepMedPrinterModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return NAME;
  }

  private boolean hasConnectPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
    return ContextCompat.checkSelfPermission(
      getReactApplicationContext(),
      Manifest.permission.BLUETOOTH_CONNECT
    ) == PackageManager.PERMISSION_GRANTED;
  }

  @Nullable
  private BluetoothAdapter adapter() {
    Context ctx = getReactApplicationContext();
    BluetoothManager manager = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
    if (manager != null && manager.getAdapter() != null) return manager.getAdapter();
    return BluetoothAdapter.getDefaultAdapter();
  }

  @ReactMethod
  public void getPairedPrinters(Promise promise) {
    try {
      if (!hasConnectPermission()) {
        promise.reject("E_BT_PERM", "Bluetooth permission required");
        return;
      }
      BluetoothAdapter adapter = adapter();
      if (adapter == null) {
        promise.reject("E_BT", "Bluetooth not available");
        return;
      }
      WritableArray out = Arguments.createArray();
      Set<BluetoothDevice> bonded = adapter.getBondedDevices();
      if (bonded != null) {
        for (BluetoothDevice device : bonded) {
          WritableMap row = Arguments.createMap();
          String address = device.getAddress();
          String name = device.getName();
          row.putString("address", address != null ? address : "");
          row.putString("name", name != null && !name.isEmpty() ? name : address);
          out.pushMap(row);
        }
      }
      promise.resolve(out);
    } catch (Exception e) {
      promise.reject("E_BT_LIST", e.getMessage(), e);
    }
  }

  @ReactMethod
  public void printBase64(String macAddress, String payloadBase64, Promise promise) {
    printBase64WithTrailing(macAddress, payloadBase64, null, promise);
  }

  @ReactMethod
  public void printBase64WithTrailing(
    String macAddress,
    String payloadBase64,
    @Nullable String trailingBase64,
    Promise promise
  ) {
    executor.execute(() -> {
      BluetoothSocket socket = null;
      try {
        if (!hasConnectPermission()) {
          promise.reject("E_BT_PERM", "Bluetooth permission required");
          return;
        }
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
          promise.reject("E_BT", "Bluetooth not available");
          return;
        }
        if (!adapter.isEnabled()) {
          promise.reject("E_BT_OFF", "Turn on Bluetooth");
          return;
        }
        if (macAddress == null || macAddress.trim().isEmpty()) {
          promise.reject("E_MAC", "Printer MAC address required");
          return;
        }
        byte[] payload = Base64.decode(payloadBase64, Base64.DEFAULT);
        byte[] trailing = (trailingBase64 == null || trailingBase64.isEmpty())
          ? new byte[0]
          : Base64.decode(trailingBase64, Base64.DEFAULT);

        BluetoothDevice device = adapter.getRemoteDevice(macAddress.trim());
        adapter.cancelDiscovery();
        Exception primaryError = null;
        try {
          socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
          socket.connect();
          writeAll(socket.getOutputStream(), payload, trailing);
          promise.resolve(true);
          return;
        } catch (Exception e) {
          primaryError = e;
          try { if (socket != null) socket.close(); } catch (Exception ignored) {}
          socket = null;
        }

        try {
          Method m = device.getClass().getMethod("createRfcommSocket", int.class);
          socket = (BluetoothSocket) m.invoke(device, 1);
          socket.connect();
          writeAll(socket.getOutputStream(), payload, trailing);
          promise.resolve(true);
        } catch (Exception e2) {
          String msg = e2.getMessage() != null ? e2.getMessage()
            : (primaryError != null && primaryError.getMessage() != null ? primaryError.getMessage() : "Print failed");
          promise.reject("E_PRINT", msg, e2);
        }
      } catch (Exception e) {
        promise.reject("E_PRINT", e.getMessage(), e);
      } finally {
        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
      }
    });
  }

  private void writeAll(OutputStream out, byte[] payload, byte[] trailing) throws Exception {
    writeChunked(out, payload);
    if (trailing != null && trailing.length > 0) {
      // Milestone feeds an extra blank label after PRINT; reverse after feed completes.
      Thread.sleep(900);
      writeChunked(out, trailing);
    }
    Thread.sleep(350);
  }

  private void writeChunked(OutputStream out, byte[] data) throws Exception {
    int i = 0;
    while (i < data.length) {
      int end = Math.min(i + CHUNK, data.length);
      out.write(data, i, end - i);
      out.flush();
      i = end;
      if (i < data.length) Thread.sleep(20);
    }
  }
}
