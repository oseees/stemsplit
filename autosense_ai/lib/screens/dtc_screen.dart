import 'package:flutter/material.dart';

import '../models/car_data.dart';
import '../services/obd_service.dart';

class DtcScreen extends StatefulWidget {
  final ObdService obdService;

  /// Pre-filter to a specific category tab (optional).
  final DtcCategory? initialFilter;

  const DtcScreen({
    super.key,
    required this.obdService,
    this.initialFilter,
  });

  @override
  State<DtcScreen> createState() => _DtcScreenState();
}

class _DtcScreenState extends State<DtcScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<DtcResult> _allResults = [];
  bool _loading = false;

  static const _tabs = [
    DtcCategory.engine,
    DtcCategory.transmission,
    DtcCategory.body,
    DtcCategory.network,
  ];

  @override
  void initState() {
    super.initState();
    final initialIndex =
        widget.initialFilter != null ? _tabs.indexOf(widget.initialFilter!) : 0;
    _tabController = TabController(
      length: _tabs.length,
      vsync: this,
      initialIndex: initialIndex.clamp(0, _tabs.length - 1),
    );
    _scan();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    setState(() => _loading = true);
    try {
      final results = await widget.obdService.readAllDtc();
      if (mounted) setState(() => _allResults = results);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Scan failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _clearCodes() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2C),
        title: const Text('Clear All Codes?'),
        content: const Text(
          'This will clear stored DTCs and turn off the check engine light. '
          'Permanent codes cannot be cleared until the issue is fixed.\n\n'
          'Are you sure?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Clear Codes'),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _loading = true);
    final success = await widget.obdService.clearDtcCodes();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(success ? 'Codes cleared successfully' : 'Failed to clear codes'),
        ),
      );
      // Re-scan to refresh
      await _scan();
    }
  }

  List<DtcResult> _filtered(DtcCategory cat) =>
      _allResults.where((r) => r.category == cat).toList();

  int _countFor(DtcCategory cat) => _filtered(cat).length;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Diagnostics'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Clear codes',
            onPressed: _loading ? null : _clearCodes,
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Re-scan',
            onPressed: _loading ? null : _scan,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: _tabs.map((cat) {
            final count = _countFor(cat);
            return Tab(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(cat.label),
                  if (count > 0) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.red,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '$count',
                        style: const TextStyle(fontSize: 11, color: Colors.white),
                      ),
                    ),
                  ],
                ],
              ),
            );
          }).toList(),
        ),
      ),
      body: _loading
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Scanning vehicle...', style: TextStyle(color: Colors.grey)),
                ],
              ),
            )
          : TabBarView(
              controller: _tabController,
              children: _tabs.map((cat) => _DtcList(results: _filtered(cat))).toList(),
            ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// DTC list for one tab
// ═══════════════════════════════════════════════════════════════════════

class _DtcList extends StatelessWidget {
  final List<DtcResult> results;

  const _DtcList({required this.results});

  @override
  Widget build(BuildContext context) {
    if (results.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle_outline, size: 72, color: Colors.green.shade400),
            const SizedBox(height: 16),
            Text('No codes found', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              'This system is running clean.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.grey),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: results.length,
      itemBuilder: (context, index) {
        final r = results[index];
        return _DtcCard(result: r);
      },
    );
  }
}

class _DtcCard extends StatelessWidget {
  final DtcResult result;

  const _DtcCard({required this.result});

  Color get _borderColor {
    return switch (result.type) {
      DtcType.stored => Colors.red.shade800,
      DtcType.pending => Colors.orange.shade800,
      DtcType.permanent => Colors.purple.shade800,
    };
  }

  Color get _badgeColor {
    return switch (result.type) {
      DtcType.stored => Colors.red,
      DtcType.pending => Colors.orange,
      DtcType.permanent => Colors.purple,
    };
  }

  IconData get _icon {
    return switch (result.category) {
      DtcCategory.engine => Icons.engineering,
      DtcCategory.transmission => Icons.settings,
      DtcCategory.body => Icons.directions_car,
      DtcCategory.network => Icons.cable,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF1A1A24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: _borderColor, width: 0.5),
      ),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Icon
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: _badgeColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(_icon, color: _badgeColor, size: 24),
            ),
            const SizedBox(width: 14),

            // Text
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        result.code,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 17,
                          color: _badgeColor,
                          fontFamily: 'monospace',
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: _badgeColor.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          result.type.label,
                          style: TextStyle(fontSize: 11, color: _badgeColor),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    result.description,
                    style: const TextStyle(color: Colors.white70, height: 1.3),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
