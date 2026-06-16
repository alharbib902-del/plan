import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_exception.dart';
import '../referrals/referral.dart';
import '../referrals/referrals_repository.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// The client's referral program (read-only) for `/referrals`: their code +
/// share link (copy-to-clipboard) + their own referrals. NOT flag-gated. The
/// code can be null on a soft RPC failure (a "try later" notice is shown).
class ReferralsScreen extends ConsumerWidget {
  const ReferralsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(referralsSummaryProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('الإحالات')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(referralsSummaryProvider),
        ),
        data: (s) => RefreshIndicator(
          onRefresh: () => ref.refresh(referralsSummaryProvider.future),
          child: _Body(summary: s),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.summary});

  final ReferralsSummary summary;

  void _copy(BuildContext context, String value, String done) {
    Clipboard.setData(ClipboardData(text: value));
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(done)));
  }

  @override
  Widget build(BuildContext context) {
    final code = summary.code;
    final shareUrl = summary.shareUrl;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text(
          'ادعُ أصدقاءك إلى Aeris',
          style: TextStyle(
            color: AerisColors.inkPrimary,
            fontSize: 20,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'شارك كودك؛ تحصل على مكافأة عند أول حجز مدفوع لمن تدعوه.',
          style: TextStyle(color: AerisColors.inkSecondary, height: 1.6),
        ),
        const SizedBox(height: 20),
        if (code == null)
          const _Notice('تعذّر تحميل كود الإحالة، حاول لاحقاً')
        else ...[
          _CodeCard(
            code: code,
            onCopy: () => _copy(context, code, 'تم نسخ الكود'),
          ),
          if (shareUrl != null) ...[
            const SizedBox(height: 14),
            const Text(
              'رابط المشاركة',
              style: TextStyle(
                color: AerisColors.inkSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    shareUrl,
                    style: const TextStyle(color: AerisColors.gold),
                  ),
                ),
                IconButton(
                  tooltip: 'نسخ الرابط',
                  icon: const Icon(Icons.copy, color: AerisColors.gold),
                  onPressed: () =>
                      _copy(context, shareUrl, 'تم نسخ الرابط'),
                ),
              ],
            ),
          ],
        ],
        const SizedBox(height: 24),
        const Text(
          'إحالاتي',
          style: TextStyle(
            color: AerisColors.inkPrimary,
            fontSize: 17,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 10),
        if (summary.referrals.isEmpty)
          const _Notice('لا توجد إحالات بعد')
        else
          ...summary.referrals.map((r) => _ReferralTile(referral: r)),
      ],
    );
  }
}

class _CodeCard extends StatelessWidget {
  const _CodeCard({required this.code, required this.onCopy});

  final String code;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AerisColors.gold.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('كود الإحالة',
                    style: TextStyle(
                        color: AerisColors.inkSecondary, fontSize: 13)),
                const SizedBox(height: 4),
                SelectableText(
                  code,
                  style: const TextStyle(
                    color: AerisColors.gold,
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 2,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'نسخ الكود',
            icon: const Icon(Icons.copy, color: AerisColors.gold),
            onPressed: onCopy,
          ),
        ],
      ),
    );
  }
}

class _ReferralTile extends StatelessWidget {
  const _ReferralTile({required this.referral});

  final Referral referral;

  @override
  Widget build(BuildContext context) {
    final rewarded = referral.status == 'rewarded';
    final date = formatDate(referral.rewardedAt) ?? formatDate(referral.createdAt);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AerisColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                StatusPill(
                  label: referralStatusAr(referral.status),
                  color: rewarded ? AerisColors.gold : AerisColors.inkSecondary,
                ),
                if (date != null) ...[
                  const SizedBox(height: 6),
                  Text(date,
                      style: const TextStyle(
                          color: AerisColors.inkMuted, fontSize: 12)),
                ],
              ],
            ),
          ),
          if (rewarded && referral.referrerRewardSar != null)
            Text(
              formatSar(referral.referrerRewardSar),
              style: const TextStyle(
                  color: AerisColors.gold, fontWeight: FontWeight.w700),
            ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AerisColors.border),
      ),
      child: Text(
        message,
        style: const TextStyle(color: AerisColors.inkSecondary),
      ),
    );
  }
}
