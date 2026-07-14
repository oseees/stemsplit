import 'package:flutter/material.dart';
import 'package:flutter_bluetooth_serial/flutter_bluetooth_serial.dart';
import 'package:permission_handler/permission_handler.dart';

import '../services/obd_service.dart';
import 'dashboard_screen.dart';

class BluetoothScreen extends StatefulWidget {
  final ObdService obdService;

  const BluetoothScreen({super.key, required this.obdService});

  @override
  State<BluetoothScreen> createState() => _BluetoothScreenState();
}

class _BluetoothScreenState extends State<BluetoothScreen> {
  List<BluetoothDevice> _devices = [];
  bool _scanning = false;
  String? _connectingAddress;

  @override
  void initState() {
    super.initState();
    _requestPermissions();
  }

  Future<void> _requestPermissions() async {
    await [
      Permission.bluetooth,
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
      Permission.location,
    ].request();
  }

  Future<void> _scan() async {
    setState(() {
      _scanning = true;
      _devices = [];
    });

    try {
      final devices = await widget.obdService.scanDevices();
      setState(() => _devices = devices);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Scan failed: $e')),
        );
      }
    } finally {
      setState(() => _scanning = false);
    }
  }

  Future<void> _connect(BluetoothDevice device) async {
    setState(() => _connectingAddress = device.address);

    final success = await widget.obdService.connect(device);

    if (!mounted) return;
    setState(() => _connectingAddress = null);

    if (success) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => DashboardScreen(obdService: widget.obdService),
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Connection failed. Try again.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AutoSense AI')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            // ── Header ────────────────────────────────────────────
            Icon(Icons.directions_car, size: 80, color: Colors.cyan.shade400),
            const SizedBox(height: 12),
            Text(
              'Connect your OBD2 adapter',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              'Pair your ELM327 in phone Settings first,\nthen tap Scan below.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Colors.grey,
                  ),
            ),
            const SizedBox(height: 24),

            // ── Scan button ───────────────────────────────────────
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _scanning ? null : _scan,
                icon: _scanning
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.bluetooth_searching),
                label: Text(_scanning ? 'Scanning...' : 'Scan for Devices'),
              ),
            ),
            const SizedBox(height: 20),

            // ── Device list ───────────────────────────────────────
            Expanded(
              child: _devices.isEmpty
                  ? Center(
                      child: Text(
                        _scanning ? '' : 'No devices found yet.',
                        style: const TextStyle(color: Colors.grey),
                      ),
                    )
                  : ListView.separated(
                      itemCount: _devices.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final device = _devices[index];
                        final isConnecting =
                            _connectingAddress == device.address;

                        return ListTile(
                          leading: const Icon(Icons.bluetooth, color: Colors.cyan),
                          title: Text(device.name ?? 'Unknown Device'),
                          subtitle: Text(device.address),
                          trailing: isConnecting
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.chevron_right),
                          onTap: isConnecting ? null : () => _connect(device),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
