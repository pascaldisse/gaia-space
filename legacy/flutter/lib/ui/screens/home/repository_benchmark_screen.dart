import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/repository_benchmark_service.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';

final repositoryBenchmarkServiceProvider = Provider<RepositoryBenchmarkService>((ref) {
  return RepositoryBenchmarkService();
});

/// A screen for benchmarking repository performance
class RepositoryBenchmarkScreen extends ConsumerStatefulWidget {
  final GitRepository repository;

  const RepositoryBenchmarkScreen({
    Key? key,
    required this.repository,
  }) : super(key: key);

  @override
  ConsumerState<RepositoryBenchmarkScreen> createState() => _RepositoryBenchmarkScreenState();
}

class _RepositoryBenchmarkScreenState extends ConsumerState<RepositoryBenchmarkScreen> {
  bool _isBenchmarking = false;
  bool _hasBenchmarkResults = false;
  late RepositoryBenchmarkResult _benchmarkResults;
  List<OptimizationRecommendation> _recommendations = [];
  String _errorMessage = '';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Repository Benchmark: ${widget.repository.name}'),
        actions: [
          if (_hasBenchmarkResults)
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Run benchmark again',
              onPressed: _runBenchmark,
            ),
        ],
      ),
      body: _isBenchmarking
          ? _buildLoadingView()
          : (_hasBenchmarkResults ? _buildResultsView() : _buildInitialView()),
      floatingActionButton: !_isBenchmarking && !_hasBenchmarkResults
          ? FloatingActionButton.extended(
              onPressed: _runBenchmark,
              icon: const Icon(Icons.speed),
              label: const Text('Run Benchmark'),
            )
          : null,
    );
  }

  Widget _buildLoadingView() {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          CircularProgressIndicator(),
          SizedBox(height: 16),
          Text('Running benchmark...',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          SizedBox(height: 8),
          Text('This may take a few moments.'),
        ],
      ),
    );
  }

  Widget _buildInitialView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.speed, size: 64, color: Colors.blue),
            const SizedBox(height: 24),
            Text(
              'Repository Benchmarking Tool',
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            const Text(
              'This tool measures the performance of various Git operations in your repository '
              'and provides recommendations for optimization.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            Card(
              margin: const EdgeInsets.symmetric(horizontal: 32, vertical: 8),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'What we measure:',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    _buildBulletPoint('Git status performance'),
                    _buildBulletPoint('Git log performance'),
                    _buildBulletPoint('Branch listing speed'),
                    _buildBulletPoint('Object counting performance'),
                    _buildBulletPoint('Repository integrity check'),
                    _buildBulletPoint('Repository size metrics'),
                  ],
                ),
              ),
            ),
            if (_errorMessage.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Text(
                  _errorMessage,
                  style: const TextStyle(color: Colors.red),
                  textAlign: TextAlign.center,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildBulletPoint(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('• ', style: TextStyle(fontWeight: FontWeight.bold)),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }

  Widget _buildResultsView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Overall score and summary
          _buildOverallScore(),
          
          const SizedBox(height: 24),
          
          // Benchmark charts
          _buildPerformanceCharts(),
          
          const SizedBox(height: 24),
          
          // Repository size information
          _buildRepositorySizeInfo(),
          
          const SizedBox(height: 24),
          
          // Recommendations
          if (_recommendations.isNotEmpty)
            _buildRecommendations(),
        ],
      ),
    );
  }

  Widget _buildOverallScore() {
    // Calculate a score from 0-100 based on benchmark results
    // Lower times are better
    final maxScore = 100;
    final statusWeight = 0.2;
    final logWeight = 0.3;
    final branchWeight = 0.1;
    final countObjectsWeight = 0.2;
    final fsckWeight = 0.2;
    
    // Threshold values (milliseconds)
    final statusThreshold = 500;
    final logThreshold = 1000;
    final branchThreshold = 300;
    final countObjectsThreshold = 300;
    final fsckThreshold = 2000;
    
    // Calculate individual scores (0-100)
    final statusScore = (_benchmarkResults.gitStatusTime < statusThreshold) 
        ? (1 - _benchmarkResults.gitStatusTime / statusThreshold) * 100
        : 0.0;
    
    final logScore = (_benchmarkResults.gitLogTime < logThreshold) 
        ? (1 - _benchmarkResults.gitLogTime / logThreshold) * 100
        : 0.0;
    
    final branchScore = (_benchmarkResults.gitBranchTime < branchThreshold) 
        ? (1 - _benchmarkResults.gitBranchTime / branchThreshold) * 100
        : 0.0;
    
    final countObjectsScore = (_benchmarkResults.gitCountObjectsTime < countObjectsThreshold) 
        ? (1 - _benchmarkResults.gitCountObjectsTime / countObjectsThreshold) * 100
        : 0.0;
    
    final fsckScore = (_benchmarkResults.gitFsckTime < fsckThreshold) 
        ? (1 - _benchmarkResults.gitFsckTime / fsckThreshold) * 100
        : 0.0;
    
    // Calculate weighted average
    final overallScore = (statusScore * statusWeight) +
        (logScore * logWeight) +
        (branchScore * branchWeight) +
        (countObjectsScore * countObjectsWeight) +
        (fsckScore * fsckWeight);
    
    // Determine performance category
    String performanceCategory;
    Color performanceColor;
    
    if (overallScore >= 80) {
      performanceCategory = 'Excellent';
      performanceColor = Colors.green;
    } else if (overallScore >= 60) {
      performanceCategory = 'Good';
      performanceColor = Colors.lightGreen;
    } else if (overallScore >= 40) {
      performanceCategory = 'Average';
      performanceColor = Colors.amber;
    } else if (overallScore >= 20) {
      performanceCategory = 'Slow';
      performanceColor = Colors.orange;
    } else {
      performanceCategory = 'Very Slow';
      performanceColor = Colors.red;
    }
    
    return Card(
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Performance Score',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                // Circular progress indicator for the score
                SizedBox(
                  width: 80,
                  height: 80,
                  child: Stack(
                    children: [
                      SizedBox(
                        width: 80,
                        height: 80,
                        child: CircularProgressIndicator(
                          value: overallScore / 100,
                          strokeWidth: 8,
                          backgroundColor: Colors.grey.shade300,
                          valueColor: AlwaysStoppedAnimation<Color>(performanceColor),
                        ),
                      ),
                      Center(
                        child: Text(
                          '${overallScore.round()}',
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                // Performance category and details
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        performanceCategory,
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                          color: performanceColor,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Total benchmark time: ${(_benchmarkResults.totalTime / 1000).toStringAsFixed(2)} seconds',
                        style: const TextStyle(fontSize: 14),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Benchmark date: ${DateFormat.yMMMd().add_Hm().format(_benchmarkResults.benchmarkDate)}',
                        style: const TextStyle(fontSize: 14),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPerformanceCharts() {
    // Create data for the chart
    final barGroups = [
      BarChartGroupData(
        x: 0,
        barRods: [
          BarChartRodData(
            toY: _benchmarkResults.gitStatusTime.toDouble(),
            color: Colors.blue,
            width: 22,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(6),
              topRight: Radius.circular(6),
            ),
          ),
        ],
      ),
      BarChartGroupData(
        x: 1,
        barRods: [
          BarChartRodData(
            toY: _benchmarkResults.gitLogTime.toDouble(),
            color: Colors.green,
            width: 22,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(6),
              topRight: Radius.circular(6),
            ),
          ),
        ],
      ),
      BarChartGroupData(
        x: 2,
        barRods: [
          BarChartRodData(
            toY: _benchmarkResults.gitBranchTime.toDouble(),
            color: Colors.amber,
            width: 22,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(6),
              topRight: Radius.circular(6),
            ),
          ),
        ],
      ),
      BarChartGroupData(
        x: 3,
        barRods: [
          BarChartRodData(
            toY: _benchmarkResults.gitCountObjectsTime.toDouble(),
            color: Colors.orange,
            width: 22,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(6),
              topRight: Radius.circular(6),
            ),
          ),
        ],
      ),
      BarChartGroupData(
        x: 4,
        barRods: [
          BarChartRodData(
            toY: _benchmarkResults.gitFsckTime.toDouble(),
            color: Colors.purple,
            width: 22,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(6),
              topRight: Radius.circular(6),
            ),
          ),
        ],
      ),
    ];

    return Card(
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Operation Timings (milliseconds)',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              height: 300,
              child: BarChart(
                BarChartData(
                  alignment: BarChartAlignment.spaceAround,
                  maxY: _getMaxY(),
                  titlesData: FlTitlesData(
                    leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        reservedSize: 40,
                        getTitlesWidget: (value, meta) {
                          return SideTitleWidget(
                            axisSide: meta.axisSide,
                            child: Text(value.toInt().toString()),
                          );
                        },
                      ),
                    ),
                    rightTitles: const AxisTitles(
                      sideTitles: SideTitles(showTitles: false),
                    ),
                    topTitles: const AxisTitles(
                      sideTitles: SideTitles(showTitles: false),
                    ),
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          final titles = [
                            'Status',
                            'Log',
                            'Branch',
                            'Count Obj',
                            'FSCK',
                          ];
                          
                          return SideTitleWidget(
                            axisSide: meta.axisSide,
                            child: Padding(
                              padding: const EdgeInsets.only(top: 8.0),
                              child: Text(
                                titles[value.toInt()],
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                  borderData: FlBorderData(show: false),
                  gridData: const FlGridData(show: false),
                  barGroups: barGroups,
                ),
              ),
            ),
            const SizedBox(height: 16),
            // Legend with specific operation times
            _buildTimingEntry('Git Status', _benchmarkResults.gitStatusTime, Colors.blue),
            _buildTimingEntry('Git Log', _benchmarkResults.gitLogTime, Colors.green),
            _buildTimingEntry('Git Branch', _benchmarkResults.gitBranchTime, Colors.amber),
            _buildTimingEntry('Git Count Objects', _benchmarkResults.gitCountObjectsTime, Colors.orange),
            _buildTimingEntry('Git FSCK', _benchmarkResults.gitFsckTime, Colors.purple),
          ],
        ),
      ),
    );
  }

  double _getMaxY() {
    // Find the maximum timing value for the chart scale
    final values = [
      _benchmarkResults.gitStatusTime,
      _benchmarkResults.gitLogTime,
      _benchmarkResults.gitBranchTime,
      _benchmarkResults.gitCountObjectsTime,
      _benchmarkResults.gitFsckTime,
    ];
    
    final maxValue = values.reduce((a, b) => a > b ? a : b).toDouble();
    
    // Add some headroom
    return maxValue * 1.2;
  }

  Widget _buildTimingEntry(String operation, int timeMs, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        children: [
          Container(
            width: 16,
            height: 16,
            color: color,
          ),
          const SizedBox(width: 8),
          Text(
            operation,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          const Spacer(),
          Text(
            '$timeMs ms',
            style: const TextStyle(fontFamily: 'monospace'),
          ),
        ],
      ),
    );
  }

  Widget _buildRepositorySizeInfo() {
    // Format sizes for display
    final String formattedDiskSize = _formatByteSize(_benchmarkResults.diskSize);
    final String formattedPackSize = _formatByteSize(_benchmarkResults.packSize);

    return Card(
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Repository Size',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            _buildSizeBar(),
            const SizedBox(height: 24),
            // Size details
            _buildSizeEntry('Total Objects', '${_benchmarkResults.totalObjects}', Icons.bubble_chart),
            _buildSizeEntry('Loose Object Size', formattedDiskSize, Icons.folder),
            _buildSizeEntry('Pack Size', formattedPackSize, Icons.archive),
            const Divider(),
            _buildSizeEntry('Total Size', _formatByteSize(_benchmarkResults.diskSize + _benchmarkResults.packSize), Icons.storage),
          ],
        ),
      ),
    );
  }

  Widget _buildSizeBar() {
    // Calculate proportions for the stacked bar chart
    final double totalSize = _benchmarkResults.diskSize + _benchmarkResults.packSize;
    
    if (totalSize == 0) {
      return const SizedBox(height: 32);
    }
    
    final double looseRatio = _benchmarkResults.diskSize / totalSize;
    
    return SizedBox(
      height: 32,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Row(
          children: [
            // Loose objects
            Expanded(
              flex: (looseRatio * 100).round(),
              child: Container(
                color: Colors.blue,
                child: Center(
                  child: _benchmarkResults.diskSize > totalSize * 0.15
                      ? Text(
                          'Loose',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        )
                      : const SizedBox(),
                ),
              ),
            ),
            // Packed objects
            Expanded(
              flex: ((1 - looseRatio) * 100).round(),
              child: Container(
                color: Colors.green,
                child: Center(
                  child: _benchmarkResults.packSize > totalSize * 0.15
                      ? Text(
                          'Packed',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        )
                      : const SizedBox(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSizeEntry(String label, String value, IconData icon) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
          const Spacer(),
          Text(
            value,
            style: const TextStyle(fontFamily: 'monospace'),
          ),
        ],
      ),
    );
  }

  Widget _buildRecommendations() {
    return Card(
      elevation: 4,
      color: Theme.of(context).colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Optimization Recommendations',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            ..._recommendations.map((recommendation) => _buildRecommendationCard(recommendation)),
          ],
        ),
      ),
    );
  }

  Widget _buildRecommendationCard(OptimizationRecommendation recommendation) {
    // Determine color based on severity
    Color severityColor;
    switch (recommendation.severity) {
      case RecommendationSeverity.high:
        severityColor = Colors.red;
        break;
      case RecommendationSeverity.medium:
        severityColor = Colors.orange;
        break;
      case RecommendationSeverity.low:
        severityColor = Colors.blue;
        break;
    }
    
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(
          Icons.tips_and_updates,
          color: severityColor,
        ),
        title: Text(
          recommendation.title,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(recommendation.description),
            if (recommendation.command.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8.0),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade200,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    recommendation.command,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: Colors.grey.shade800,
                    ),
                  ),
                ),
              ),
          ],
        ),
        isThreeLine: recommendation.command.isNotEmpty,
      ),
    );
  }

  String _formatByteSize(int bytes) {
    if (bytes < 1024) {
      return '$bytes B';
    } else if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    } else if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    } else {
      return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
    }
  }

  Future<void> _runBenchmark() async {
    final benchmarkService = ref.read(repositoryBenchmarkServiceProvider);
    
    setState(() {
      _isBenchmarking = true;
      _errorMessage = '';
    });
    
    try {
      // Run the benchmark
      final results = await benchmarkService.benchmarkRepository(widget.repository);
      
      // Generate recommendations
      final recommendations = benchmarkService.generateRecommendations(results);
      
      setState(() {
        _benchmarkResults = results;
        _recommendations = recommendations;
        _hasBenchmarkResults = true;
        _isBenchmarking = false;
      });
    } catch (e) {
      setState(() {
        _isBenchmarking = false;
        _errorMessage = 'Error running benchmark: $e';
      });
    }
  }
}